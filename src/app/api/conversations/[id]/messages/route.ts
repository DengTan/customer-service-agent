import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { ConversationService } from '@/server/services/conversation-service';
import { AutoReplyService } from '@/server/services/auto-reply-service';
import { LLMStreamingService } from '@/server/services/llm-streaming-service';
import { SubAgentService } from '@/server/services/sub-agent-service';
import { SettingsService } from '@/server/services/settings-service';
import { RoutingService } from '@/server/services/routing-service';
import type { RoutingMatchResult } from '@/server/services/routing-service';
import { RetrievalOrchestrator } from '@/server/services/retrieval-orchestrator';
import { evaluateMaxTurns } from '@/server/services/max-turns';
import type { KnowledgeSearchResult } from '@/server/services/knowledge-search-service';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { BotConfigRepository } from '@/server/repositories/bot-config-repository';
import { ContentFilterService } from '@/server/services/content-filter-service';
import { HTTP } from '@/lib/constants';
import { ConfidenceBreakdown } from '@/lib/confidence-calculator';
import { z } from 'zod';
import { withApi } from '@/lib/api/with-api';

const FORWARD_HEADER_KEYS = new Set([
  'x-request-id',
  'x-correlation-id',
  'x-b3-traceid',
  'x-b3-spanid',
  'x-b3-parentspanid',
  'x-b3-sampled',
  'x-b3-flags',
  'x-ot-span-context',
  'x-real-ip',
  'x-forwarded-for',
]);

function extractForwardHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (FORWARD_HEADER_KEYS.has(lower) || lower.startsWith('cf-')) {
      result[key] = value;
    }
  }
  return result;
}

const MessageSchema = z.object({
  content: z.string()
    .min(1, '消息内容不能为空')
    .max(HTTP.MAX_MESSAGE_LENGTH, `消息内容超过最大长度限制 ${HTTP.MAX_MESSAGE_LENGTH} 字符`),
  role: z.string().optional(),
  image_url: z.string().url('图片URL格式不正确').optional().or(z.literal('')),
  enable_sub_agent: z.boolean().optional(),
});

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
    rateLimit: { maxRequests: 20, windowMs: 60_000 },
  },
  async ({ request, params }) => {
  const { id: conversationId } = params as { id: string };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ message: { role: 'system', content: '请求体无效' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validationResult = MessageSchema.safeParse(body);
  if (!validationResult.success) {
    return new Response(JSON.stringify({ message: { role: 'system', content: validationResult.error.issues[0]?.message || '输入格式不正确' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { content: userMessage, role: messageRole, image_url: imageUrl, enable_sub_agent: enableSubAgent } = validationResult.data;

  const contentFilterService = new ContentFilterService();
  const filterResult = await contentFilterService.filterContent(userMessage, {
    conversationId,
    logEnabled: true,
  });

  if (!filterResult.allowed) {
    return NextResponse.json({
      message: {
        role: 'system',
        content: filterResult.warnings[0] || '您的消息包含不合规内容，请修改后再试。',
      },
    }, { status: 400 });
  }

  const processedMessage = filterResult.filteredContent;
  if (processedMessage !== userMessage) {
    logger.api.info('Content filtered', {
      conversationId,
      originalLength: userMessage.length,
      filteredLength: processedMessage.length,
      matches: filterResult.sensitiveWordMatches.length,
    });
  }

  const conversationService = new ConversationService();
  const autoReplyService = new AutoReplyService();
  const llmStreamingService = new LLMStreamingService();
  const subAgentService = new SubAgentService();

  const { status: convStatus } = await conversationService.ensureCanReceiveAiMessage(conversationId);

  if (convStatus === 'handoff') {
    if (messageRole === 'agent') {
      await conversationService.insertMessage({
        conversation_id: conversationId,
        role: 'agent',
        content: userMessage,
      });
      await conversationService.updateMessageCountAfterUserMessage(conversationId, userMessage);
      return NextResponse.json({
        message: {
          role: 'agent',
          content: userMessage,
          source: 'agent',
        },
      });
    }
    return NextResponse.json({
      message: {
        role: 'system',
        content: '当前对话已转交人工客服，请等待人工回复。',
      },
    });
  }

  const settingsService = new SettingsService();
  const appSettings = await settingsService.getSettingsMap();
  const maxConcurrent = parseInt(appSettings.ai_max_concurrent || '0', 10);
  if (maxConcurrent > 0) {
    const convRepo = new ConversationRepository();
    const activeCount = await convRepo.countActiveConversations();
    if (activeCount >= maxConcurrent) {
      return NextResponse.json({
        message: {
          role: 'system',
          content: `当前 AI 客服繁忙（同时服务 ${activeCount} 个对话，上限 ${maxConcurrent}），请稍后再试或转接人工客服。`,
        },
      });
    }
  }

  let llmProviderConfig: {
    providerId?: string;
    providerBaseUrl?: string;
    providerApiKey?: string;
    defaultModel?: string;
  } = {};

  const llmProviderId = appSettings.llm_provider_id;
  try {
    const { LlmProviderService } = await import('@/server/services/llm-provider-service');
    const llmService = new LlmProviderService();
    const providerConfig = await llmService.loadProviderConfig(llmProviderId);
    if (providerConfig) {
      llmProviderConfig = {
        providerId: providerConfig.providerId,
        providerBaseUrl: providerConfig.providerBaseUrl,
        providerApiKey: providerConfig.providerApiKey,
        defaultModel: providerConfig.defaultModel,
      };
    }
  } catch (error) {
    logger.api.warn('Failed to load LLM provider config', { error, providerId: llmProviderId });
  }

  const sessionInfo = await conversationService.getSessionInfo(conversationId);
  if (sessionInfo) {
    const timeoutMinutes = parseInt(appSettings.session_timeout || '0', 10);
    if (timeoutMinutes > 0) {
      const lastActiveAt = new Date(sessionInfo.updated_at).getTime();
      const elapsedMinutes = (Date.now() - lastActiveAt) / 60_000;
      if (elapsedMinutes > timeoutMinutes) {
        await conversationService.updateConversation(conversationId, { status: 'ended' });
        return NextResponse.json({
          message: {
            role: 'system',
            content: `会话已超时（超过 ${timeoutMinutes} 分钟未活跃），已自动结束。如需继续请创建新对话。`,
          },
        });
      }
    }
  }

  const maxTurns = parseInt(appSettings.max_turns || '0', 10);
  if (maxTurns > 0) {
    const existingUserTurns = await conversationService.countUserMessages(conversationId);
    const verdict = evaluateMaxTurns({ existingUserTurns, maxTurns });
    if (verdict.blocked) {
      await conversationService.updateConversation(conversationId, { status: 'ended' });
      return NextResponse.json({
        message: {
          role: 'system',
          content: verdict.message,
        },
      });
    }
  }

  await conversationService.insertMessage({
    conversation_id: conversationId,
    role: 'user',
    content: userMessage,
    image_url: imageUrl || null,
  });

  await conversationService.updateMessageCountAfterUserMessage(conversationId, userMessage);

  const autoReply = await autoReplyService.matchReply(processedMessage);

  if (autoReply) {
    const filteredAutoReplyContent = await contentFilterService.filterAssistantContent(autoReply.content);

    await conversationService.insertMessage({
      conversation_id: conversationId,
      role: 'assistant',
      content: filteredAutoReplyContent,
      confidence: 1.0,
      sources: [{ type: 'auto_reply', keyword: autoReply.rule.keyword }],
    });

    await conversationService.incrementMessageCount(conversationId);

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: filteredAutoReplyContent,
        sources: [{ type: 'auto_reply' }],
        confidence: 1.0,
      },
    });
  }

  const historyMessages = await conversationService.listMessageHistory(conversationId, 20);

  let routingMatch: RoutingMatchResult | null = null;
  try {
    const routingService = new RoutingService();
    routingMatch = await routingService.matchRule(processedMessage);
    if (routingMatch) {
      logger.api.info('[messages/route] Routing rule matched', {
        ruleId: routingMatch.rule.id,
        botId: routingMatch.bot.id,
        botName: routingMatch.bot.name,
        hasTools: Array.isArray(routingMatch.bot.tools) && routingMatch.bot.tools.length > 0,
        hasKnowledgeIds: Array.isArray(routingMatch.bot.knowledge_ids) && routingMatch.bot.knowledge_ids.length > 0,
      });
    }
  } catch (err) {
    logger.agent.debug('[messages/route] routing match error, falling back to default', { error: err });
  }

  const orchestrator = new RetrievalOrchestrator();
  const recentMessages = historyMessages.slice(-10).map(m => ({
    role: (m as unknown as { role: string }).role,
    content: (m as unknown as { content: string }).content,
  }));

  const routedBotKnowledgeIds: string[] | undefined =
    routingMatch?.bot?.knowledge_ids
      ? (Array.isArray(routingMatch.bot.knowledge_ids) && routingMatch.bot.knowledge_ids.length > 0
          ? routingMatch.bot.knowledge_ids as string[]
          : undefined)
      : undefined;

  const routedBotTools: string[] | undefined =
    routingMatch?.bot?.tools
      ? (Array.isArray(routingMatch.bot.tools) && routingMatch.bot.tools.length > 0
          ? routingMatch.bot.tools as string[]
          : undefined)
      : undefined;

  const retrievalResult = await orchestrator.retrieve(processedMessage, recentMessages, {
    useHybrid: true,
    routedKnowledgeIds: routedBotKnowledgeIds,
  });
  const { evidence: evidenceBundle } = retrievalResult;
  const orchestratorCitations = evidenceBundle.citations;

  const knowledgeResult: KnowledgeSearchResult = retrievalResult.knowledgeContext
    ? {
        context: retrievalResult.knowledgeContext.context,
        sources: retrievalResult.knowledgeContext.knowledgeSources,
        confidence: retrievalResult.knowledgeContext.confidence,
        images: retrievalResult.knowledgeContext.images,
      }
    : { context: '', sources: [], confidence: 0, images: [] };
  const productContext = retrievalResult.productContext?.productContext ?? '';
  const sizeChartContext = retrievalResult.sizeChartContext?.sizeChartContext ?? '';

  const customHeaders = extractForwardHeaders(request.headers);

  const botConfigRepo = new BotConfigRepository();
  let shopBotSystemPrompt: string | undefined;
  let shopBotId: string | undefined;
  let shopBotName: string | undefined;

  try {
    const conversation = await conversationService.getConversationBasic(conversationId);
    const shopId = conversation?.platform_connection_id;

    if (shopId) {
      const shopBot = await botConfigRepo.findByShopId(shopId);
      if (shopBot && shopBot.status === 'active') {
        shopBotSystemPrompt = shopBot.system_prompt;
        shopBotId = shopBot.id;
        shopBotName = shopBot.name;
        logger.api.info('Using shop-bound bot', { shopId, botId: shopBotId, botName: shopBotName });
      } else {
        logger.api.info('No active bot bound to shop', { shopId });
      }
    } else {
      logger.api.debug('Conversation has no shop association, using default/system prompt');
    }
  } catch (botLookupError) {
    logger.api.error('Failed to lookup shop bot, falling back to default', { error: botLookupError, conversationId });
  }

  let routingSystemPrompt: string | undefined;
  if (routingMatch?.bot?.system_prompt) {
    routingSystemPrompt = routingMatch.bot.system_prompt;
    if (enableSubAgent && !routingMatch.bot.is_sub_agent) {
      shopBotId = routingMatch.bot.id;
    }
  }

  const parentBotId = shopBotId;
  let subAgentDelegationResult: { childBotName: string; responseContent: string; confidence: number; delegationId: string } | null = null;
  if (enableSubAgent && parentBotId) {
    try {
      const intentResult = await subAgentService.detectIntentAndRoute(parentBotId, processedMessage);
      if (intentResult.matchedSubAgent && intentResult.confidence >= 0.5) {
        const result = await subAgentService.delegateTask({
          conversation_id: conversationId,
          parent_bot_id: parentBotId,
          child_bot_id: intentResult.matchedSubAgent.id,
          trigger_intent: intentResult.intent || undefined,
          input_message: userMessage,
        });
        subAgentDelegationResult = {
          childBotName: result.childBot.name,
          responseContent: result.responseContent,
          confidence: result.confidence,
          delegationId: result.delegation.id,
        };

        const subAgentBreakdown: ConfidenceBreakdown = {
          knowledge_score: 0,
          tool_score: 0,
          sub_agent_score: result.confidence,
          handoff_intent: false,
          no_support: false,
          final: result.confidence,
        };

        const filteredSubAgentContent = await contentFilterService.filterAssistantContent(result.responseContent);

        await conversationService.insertMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: `**${result.childBot.name}** 处理结果：\n\n${filteredSubAgentContent}`,
          confidence: result.confidence,
          sources: [{ type: 'sub_agent_delegation', childBotName: result.childBot.name, triggerIntent: intentResult.intent, delegationId: result.delegation.id, knowledge_item_id: result.delegation.id }],
          confidence_breakdown: subAgentBreakdown,
        });

        await conversationService.incrementMessageCount(conversationId);

        const delegationStream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              content: `**${result.childBot.name}** 处理结果：\n\n`,
              delegation: {
                childBotName: result.childBot.name,
                intent: intentResult.intent,
                confidence: result.confidence,
              },
            })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: filteredSubAgentContent })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, confidence: result.confidence, confidence_breakdown: subAgentBreakdown, sources: [{ type: 'sub_agent_delegation', childBotName: result.childBot.name }] })}\n\n`));
            controller.close();
          },
        });

        return new Response(delegationStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }
    } catch (delegationError) {
      logger.api.error('Proactive sub-agent delegation failed, falling back to LLM', { error: delegationError, conversationId });
    }
  }

  const abortController = new AbortController();
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = llmStreamingService.createStream(conversationId, processedMessage, historyMessages, {
      knowledgeContext: knowledgeResult.context || undefined,
      knowledgeConfidence: knowledgeResult.confidence,
      evidenceCitations: orchestratorCitations,
      knowledgeImages: knowledgeResult.images,
      productContext: productContext || undefined,
      sizeChartContext: sizeChartContext || undefined,
      imageUrl: imageUrl || null,
      customHeaders,
      knowledgeMinScore: retrievalResult.minScore,
      retrievalTrace: {
        action: retrievalResult.decision.action,
        reasonCode: retrievalResult.decision.reasonCode,
        provenanceVersion: retrievalResult.evidence.trace.provenanceVersion,
        rerankDegraded: retrievalResult.evidence.trace.rerankDegraded,
        candidateCount: retrievalResult.evidence.candidates.length,
        citationCount: retrievalResult.evidence.citations.length,
      },
      parentBotId,
      parentBotName: shopBotName,
      enableSubAgentDelegation: !!parentBotId,
      aiModel: appSettings.ai_model_enabled === 'false'
        ? undefined
        : appSettings.ai_model,
      multimodalModel: appSettings.multimodal_model,
      multimodalEnabled: appSettings.multimodal_enabled !== 'false',
      multimodalDisabledAction: (appSettings.multimodal_disabled_action === 'handoff' ? 'handoff' : 'fixed_message') as 'fixed_message' | 'handoff',
      multimodalFixedMessage: appSettings.multimodal_fixed_message || undefined,
      systemPrompt: routingSystemPrompt || shopBotSystemPrompt || appSettings.system_prompt || undefined,
      temperature: appSettings.ai_temperature ? parseFloat(appSettings.ai_temperature) : undefined,
      maxTokens: appSettings.ai_max_tokens ? parseInt(appSettings.ai_max_tokens, 10) : undefined,
      llmProviderId: llmProviderConfig.providerId,
      llmProviderBaseUrl: llmProviderConfig.providerBaseUrl,
      llmProviderApiKey: llmProviderConfig.providerApiKey,
      llmProviderDefaultModel: llmProviderConfig.defaultModel,
      routedBotTools,
      abortSignal: abortController.signal,
      abortController,
    });
  } catch (streamInitError) {
    logger.api.error('Failed to create LLM stream', { error: streamInitError, conversationId });
    const errorEvent = `data: ${JSON.stringify({ error: 'AI 服务暂时不可用，请稍后重试', done: true })}\n\n`;
    return new Response(errorEvent, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
    // @ts-expect-error - signal is supported by Next.js / Node.js Response but not in TS lib <5.3
    signal: abortController.signal,
  });
},
);
