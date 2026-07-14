import { logger } from '@/lib/logger';
import { ToolExecutionService } from './tool-execution-service';
import { SummaryService } from './summary-service';
import { AlertService } from './alert-service';
import { ConversationService } from './conversation-service';
import { SubAgentService } from './sub-agent-service';
import { QualityService, type QualityCheckContext, type QualityCheckResult } from './quality-service';
import { KnowledgeGapService } from './knowledge-gap-service';
import { ClaimSupportVerifier, type ClaimVerificationResult } from './claim-support-verifier';
import { LLMClientAdapter } from './llm-client-adapter';
import { RetrievalTraceService } from './retrieval-trace-service';
import type { CitationItem, EvidenceBundle } from './retrieval-orchestrator';
import type { RetrievalGateDecision } from './retrieval-gating-service';
import type { KnowledgeImageRef } from './knowledge-search-service';
import type { MessageHistoryItem } from '@/server/repositories/conversation-repository';
import {
  buildConfidenceFromContent,
  type ConfidenceBreakdown,
} from '@/lib/confidence-calculator';

export type PublicCitationItem = {
  type: string;
  content?: string;
  score?: number;
  knowledge_item_id?: string;
  name?: string;
  category?: string;
  keyword?: string;
  id?: string;
  title?: string;
  image_url?: string | null;
  childBotName?: string;
  triggerIntent?: string;
  delegationId?: string;
  /** Provenance version stamp; 2 = new orchestrator contract */
  provenanceVersion?: 1 | 2;
  /** P2: stable chunk ID (null when parent item matched directly) */
  chunk_id?: string | null;
  /** P2: chunk position within parent (0 when parent matched directly) */
  chunk_index?: number;
  /** P2: SHA-256 content hash for citation stability */
  content_hash?: string | null;
};

export interface LLMStreamOptions {
  /** LLM-bound retrieval context (passed to the model). Internal — not the public source list. */
  knowledgeContext?: string;
  knowledgeConfidence?: number;
  /**
   * CANONICAL public citations — already graded by the RetrievalOrchestrator.
   * These are the ONLY knowledge/product/size-chart items that may be exposed
   * in SSE `done.sources` and persisted to `Message.sources`.
   */
  evidenceCitations?: PublicCitationItem[];
  /**
   * DEPRECATED: kept for backwards compatibility only.
   * If provided, these candidates are NEVER auto-promoted to public citations.
   * Callers must migrate to `evidenceCitations`.
   */
  knowledgeSources?: Array<{ type: string; content: string; score: number; knowledge_item_id?: string; name?: string; category?: string }>;
  knowledgeImages?: KnowledgeImageRef[];
  /** LLM-bound context (not public). */
  productContext?: string; // 商品详情上下文（搜索结果格式化后）
  /** LLM-bound context (not public). */
  sizeChartContext?: string; // 尺码表上下文（搜索结果格式化后）
  imageUrl?: string | null;
  customHeaders?: Record<string, string>;
  knowledgeMinScore?: number;
  parentBotId?: string; // 主Bot ID，用于子Agent委派
  parentBotName?: string; // 主Bot名称，用于前端显示
  enableSubAgentDelegation?: boolean; // 是否启用子Agent委派
  aiModel?: string; // 普通模型（来自设置）
  multimodalModel?: string; // 多模态模型（来自设置）
  multimodalEnabled?: boolean; // 是否启用多模态（来自设置）
  multimodalDisabledAction?: 'fixed_message' | 'handoff'; // 多模态关闭时的图片处理策略
  multimodalFixedMessage?: string; // 固定话术内容（来自设置）
  systemPrompt?: string; // 系统提示词（来自设置）
  temperature?: number; // AI 温度（来自设置）
  maxTokens?: number; // AI 最大 Token（来自设置）
  // 扩展 LLM Provider 配置
  llmProviderId?: string; // LLM Provider ID（优先使用）
  llmProviderBaseUrl?: string; // Provider API Base URL
  llmProviderApiKey?: string; // Provider API Key
  llmProviderType?: 'coze' | 'openai_compatible' | 'anthropic' | 'custom'; // Provider 类型
  llmProviderDefaultModel?: string; // Provider 默认模型（用于扩展 Provider 时覆盖 aiModel）
  /** Optional provenance trace from the orchestrator (logged for observability). */
  retrievalTrace?: {
    action: string;
    reasonCode: string;
    provenanceVersion: number;
    rerankDegraded: boolean;
    candidateCount: number;
    citationCount: number;
  };
  /** P3 Phase 1: Retrieval gate decision (used to persist retrieval_traces). */
  decision?: RetrievalGateDecision;
  /** P3 Phase 1: Evidence bundle (used to persist retrieval_traces). */
  evidence?: EvidenceBundle;
  /** P3 Phase 1: when the orchestrator produced the decision/evidence, in epoch ms.
   *  Used to compute the trace's execution_time_ms. Defaults to Date.now() at createStream entry. */
  decisionStartedAtMs?: number;
  /** P2: Claim verification configuration — when provided, knowledge citations are
   *  verified by the auxiliary LLM before being sent in done.sources.
   *  Verification failures result in empty knowledge sources (fail-closed). */
  claimVerificationConfig?: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

type ImageUrlPart = { type: 'image_url'; image_url: { url: string; detail?: string } };
type TextPart = { type: 'text'; text: string };
type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string | Array<TextPart | ImageUrlPart> };

const SYSTEM_PROMPT = `你是 SmartAssist 智能客服助手，专注于为用户提供专业、准确、友好的客户服务。

核心职责：
1. 回答用户关于产品、订单、退换货、支付等常见问题
2. 根据知识库内容提供准确信息，并在回复中标注引用来源
3. 引导用户完成相关操作流程
4. 遇到无法解决的问题时，建议转接人工客服
5. 当用户需要查订单、查物流、申请退款、修改地址时，使用对应的工具进行操作

对话原则：
- 语气友好专业，简洁明了
- 优先使用知识库中的信息回答问题
- 如果知识库中没有相关内容，诚实告知并建议其他获取帮助的途径
- 多轮对话中记住上下文，保持连贯性
- 当用户表达不满时，先表示理解再提供解决方案
- 需要执行操作时（查订单、查物流等），使用工具而不是仅描述流程

回复格式：
- 如果引用了知识库信息，在回复末尾用【引用来源：xxx】标注
- 分步骤说明时使用编号列表
- 关键信息使用加粗标记`;

const TOOL_SYSTEM_PROMPT = `

你可以使用以下工具来帮助用户完成操作型请求。当需要调用工具时，请在回复中使用以下格式：

[TOOL_CALL]工具名|参数JSON[/TOOL_CALL]

可用工具：
1. query_order_status - 查询订单状态
   参数: {"order_id": "订单编号"}
   
2. query_logistics - 查询物流信息
   参数: {"tracking_number": "物流单号或订单编号"}

3. apply_refund - 申请退款
   参数: {"order_id": "订单编号", "reason": "退款原因", "amount": 退款金额(可选)}

4. modify_shipping_address - 修改收货地址
   参数: {"order_id": "订单编号", "new_address": "新地址", "new_name": "收件人(可选)", "new_phone": "电话(可选)"}

5. query_product_detail - 查询商品详情（价格、规格、卖点、在售状态等）
   参数: {"sku": "商品SKU(可选)", "name": "商品名称(可选)", "product_id": "商品ID(可选)"}
   注：至少提供 sku/name/product_id 之一，优先使用 sku 精确查询

6. query_size_chart - 查询尺码表信息（尺码对照表、尺码推荐等）
   参数: {"sku": "商品SKU(可选)", "category": "尺码表分类(可选)", "name": "尺码表名称(可选)", "size_chart_id": "尺码表ID(可选)", "height": 身高cm(可选), "weight": 体重kg(可选)}
   注：至少提供 sku/category/name/size_chart_id 之一；提供身高体重参数时可生成个性化尺码推荐

规则：
- 只有当用户明确需要执行操作时才调用工具（如查订单、查物流、退款、改地址）
- 工具调用标记只出现一次，放在回复的合适位置
- 调用工具后，继续用自然语言解释结果
- 如果不确定参数，先询问用户
`;

const IMAGE_UNDERSTANDING_PROMPT = `
【图片理解模式】
用户发送了一张图片，你需要：
1. 仔细分析图片内容，识别问题类型（如：商品瑕疵、快递破损、包装损坏、尺寸不符、颜色差异等）
2. 用标签形式在回复开头标注识别出的问题类型，格式如：**问题类型：商品瑕疵 / 快递破损**
3. 描述图片中看到的具体问题
4. 根据问题类型，建议对应的处理策略：
   - 商品瑕疵/尺寸不符/颜色差异 → 建议退货退款
   - 快递破损/包装损坏 → 建议免费补发
   - 轻微问题 → 建议差价赔付
5. 在回复末尾用清晰格式展示可选的处理策略`;

// Image reference protocol: LLM can embed images from knowledge base in its response
const KNOWLEDGE_IMAGE_PROMPT = `

【知识库图片引用】
如果知识库检索结果中包含相关图片，你可以在回复中引用这些图片，让用户直观看到相关内容。

引用格式：[IMG:图片URL](图片描述)

规则：
- 只有当知识库确实提供了相关图片时才引用，不要编造图片URL
- 图片描述应简洁说明图片内容，如"退换货流程图"、"商品尺码对照表"
- 引用图片时，应配合文字说明，不要仅发图片
- 每次回复最多引用2张图片
- 图片引用应自然嵌入回复中，如"以下是退换货流程：[IMG:https://example.com/refund.png](退换货流程图)"`;

// Sub-agent delegation marker pattern
const DELEGATION_PATTERN = /\[DELEGATE_TO\](\w+)\|({[^}]*})\[\/DELEGATE_TO\]/g;

const SUB_AGENT_DELEGATION_PROMPT = `

【子Agent委派】
你是一个主协调Bot，下面有多个专项子Agent可以协助处理特定类型的问题。当你检测到用户的问题属于某个子Agent的专业领域时，你可以在回复中插入委派标记，系统会自动将问题转交给对应的子Agent处理。

委派格式：[DELEGATE_TO]子Agent名称|{"reason": "委派原因"}[/DELEGATE_TO]

注意：
- 只有当你认为子Agent能更好地处理该问题时才委派
- 委派后，你仍然可以对子Agent的结果进行整合和补充
- 不要委派一般性问题，只委派需要专业处理的场景
- 委派标记应该自然嵌入到你的回复中`;

// LLM self-evaluation confidence prompt
const CONFIDENCE_SELF_EVAL_PROMPT = `

【置信度自评】
请在回复的最末尾添加你对本次回答可靠性的自评置信度，格式为 [CONF:0.X]，其中 0.X 是 0.0~1.0 之间的数字。
评分标准：
- 0.9~1.0：回答基于知识库确凿信息或成功的工具调用结果，高度可靠
- 0.7~0.9：回答有知识库或工具支撑，但部分内容基于推理
- 0.5~0.7：回答主要基于通用知识，没有直接的知识库匹配
- 0.3~0.5：回答不太确定，建议用户确认或咨询人工
- 0.0~0.3：无法回答或回答很可能不准确
注意：此标签仅用于系统内部评估，不会展示给用户。每次回复必须包含此标签。`;

const TOOL_CALL_PATTERN = /\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g;

// Image reference pattern: [IMG:url](alt text)
const IMAGE_REF_PATTERN = /\[IMG:([^\]]+)\]\(([^)]+)\)/g;

/**
 * Strip internal markers from LLM output before sending to client.
 * Removes: [TOOL_CALL]...[/TOOL_CALL], [CONF:x.x], [DELEGATE_TO]...[/DELEGATE_TO]
 * Preserves: [IMG:url](alt) — these are rendered as images on the client side.
 */
function stripInternalMarkers(text: string): string {
  return text
    .replace(/\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g, '')
    .replace(/\[CONF:[0-9]*\.?[0-9]+\]/g, '')
    .replace(/\[DELEGATE_TO\][\s\S]*?\[\/DELEGATE_TO\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class LLMStreamingService {
  private readonly toolExecution = new ToolExecutionService();
  private readonly summaryService = new SummaryService();
  private readonly alertService = new AlertService();
  private readonly qualityService = new QualityService();
  private readonly conversationService = new ConversationService();
  private readonly subAgentService = new SubAgentService();
  private readonly knowledgeGapService = new KnowledgeGapService();

  /**
   * Create a streaming LLM response with SSE.
   * Returns a ReadableStream that emits SSE events.
   * Post-stream operations (insert assistant message, generate summary, check alerts)
   * are handled via fire-and-forget promises.
   */
  createStream(
    conversationId: string,
    userMessage: string,
    historyMessages: MessageHistoryItem[],
    options: LLMStreamOptions,
  ): ReadableStream {
    const encoder = new TextEncoder();
    let isAborted = false;
    let fullContent = '';
    const toolCallsData: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
    const sources: PublicCitationItem[] = [];
    let knowledgeConfidence = options.knowledgeConfidence || 0;
    const knowledgeMinScore = options.knowledgeMinScore || 0.75;
    const delegationResults: Array<{ childBotName: string; responseContent: string; confidence: number }> = [];

    // Capture service references for use inside the stream callbacks
    const toolExecution = this.toolExecution;
    const buildLLMMessages = this.buildLLMMessages.bind(this);
    const handlePostStreamOperations = this.handlePostStreamOperations.bind(this);
    const subAgentService = this.subAgentService;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Build LLM messages (include sub-agent delegation prompt if enabled)
          const llmMessages = buildLLMMessages(
            userMessage,
            historyMessages,
            options.knowledgeContext,
            options.imageUrl,
            knowledgeMinScore,
            !!(options.enableSubAgentDelegation && options.parentBotId),
            options.systemPrompt,
            options.knowledgeImages,
            options.productContext,
            options.sizeChartContext,
          );

          // Select model based on settings and whether image is present
          const defaultAiModel = 'doubao-seed-2-0-lite-260215';
          const defaultMultimodalModel = 'doubao-seed-2-0-pro-260215';
          const multimodalEnabled = options.multimodalEnabled !== false; // default true
          let llmModel: string;

          if (options.imageUrl) {
            if (multimodalEnabled) {
              llmModel = options.multimodalModel || defaultMultimodalModel;
            } else {
              // Multimodal disabled — handle based on configured action
              const action = options.multimodalDisabledAction || 'fixed_message';
              if (action === 'handoff') {
                // Trigger handoff: return a handoff message and signal client
                const handoffMessage = '您发送的图片需要人工客服处理，正在为您转接人工客服，请稍候。';
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: handoffMessage, handoff: true })}\n\n`));
                fullContent = handoffMessage;
              } else {
                // Fixed message mode — use custom message from settings or default
                const defaultFixedMessage = '抱歉，当前未开启图片识别功能，无法识别您发送的图片。如需帮助，请转接人工客服或以文字描述您的问题。';
                const fixedMessage = options.multimodalFixedMessage || defaultFixedMessage;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: fixedMessage })}\n\n`));
                fullContent = fixedMessage;
              }
              // Skip LLM, go directly to post-stream operations
              const fallbackBreakdown: ConfidenceBreakdown = {
                knowledge_score: 0,
                tool_score: 0,
                llm_self_score: 0,
                sub_agent_score: 0,
                handoff_intent: action === 'handoff',
                no_support: true,
                final: 0,
              };
              handlePostStreamOperations(
                conversationId,
                userMessage,
                fullContent,
                0, // confidence
                toolCallsData,
                sources,
                options.customHeaders || {},
                [], // no images in disabled multimodal path
                fallbackBreakdown,
              );
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, sources, confidence: 0, confidence_breakdown: fallbackBreakdown, has_tool_calls: false, botId: options.parentBotId, botName: options.parentBotName })}\n\n`));
              controller.close();
              return;
            }
          } else {
            // No image present — pick the right model
            // Priority: extended provider's default model > ai_model setting > multimodal fallback
            if (options.llmProviderDefaultModel) {
              llmModel = options.llmProviderDefaultModel;
            } else if (options.aiModel) {
              llmModel = options.aiModel;
            } else if (multimodalEnabled) {
              llmModel = options.multimodalModel || defaultMultimodalModel;
            } else {
              llmModel = defaultAiModel;
            }
          }

          // Determine which LLM client to use based on provider type
          const llmTemperature = options.temperature ?? 0.7;
          const llmMaxTokens = options.maxTokens;
          const customHeaders = options.customHeaders || {};

          // Check if using extended LLM provider (non-Coze)
          const useExtendedProvider = options.llmProviderType && options.llmProviderType !== 'coze' && options.llmProviderBaseUrl && options.llmProviderApiKey;

          let llmStreamIterator: AsyncGenerator<{ content?: string }>;

          if (useExtendedProvider) {
            // Use generic OpenAI-compatible adapter for extended providers
            const adapter = new LLMClientAdapter({
              baseUrl: options.llmProviderBaseUrl!,
              apiKey: options.llmProviderApiKey!,
              customHeaders: options.customHeaders,
            });

            const streamOptions = {
              model: llmModel,
              temperature: llmTemperature,
            };
            if (llmMaxTokens) {
              (streamOptions as Record<string, unknown>).max_tokens = llmMaxTokens;
            }

            llmStreamIterator = adapter.stream(llmMessages as Parameters<typeof adapter.stream>[0], streamOptions as Parameters<typeof adapter.stream>[1]);
          } else {
            // Use LLMClientAdapter (OpenAI-compatible API)
            const adapter = new LLMClientAdapter({
              baseUrl: process.env.COZE_BASE_URL || 'https://api.coze.cn',
              apiKey: process.env.COZE_API_KEY || '',
              customHeaders,
            });

            const streamOptions = {
              model: llmModel,
              temperature: llmTemperature,
            };
            if (llmMaxTokens) {
              (streamOptions as Record<string, unknown>).max_tokens = llmMaxTokens;
            }

            llmStreamIterator = adapter.stream(llmMessages as Parameters<typeof adapter.stream>[0], streamOptions as Parameters<typeof adapter.stream>[1]);
          }

          for await (const chunk of llmStreamIterator) {
            if (isAborted) break;
            if (chunk.content) {
              const text = chunk.content.toString();
              fullContent += text;
              // Strip internal markers before sending to client (never expose TOOL_CALL/CONF/DELEGATE markers)
              const safeText = stripInternalMarkers(text);
              if (safeText) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: safeText })}\n\n`));
              }
            }
          }

          // Post-processing: detect and execute tool calls from LLM output
          const toolExecutions = await parseAndExecuteToolCalls(fullContent, toolExecution, conversationId);

          // If tool calls were detected, execute them and get follow-up response
          if (toolExecutions.length > 0) {
            for (const te of toolExecutions) {
              toolCallsData.push({ name: te.name, args: te.args, result: te.result });
              knowledgeConfidence = Math.max(knowledgeConfidence, te.confidence);

              // Send tool result to client
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                tool_call: { name: te.name, args: te.args },
                tool_result: te.result,
              })}\n\n`));
            }

            // Get follow-up response with tool results
            const toolResultsSummary = toolExecutions
              .map(te => `工具 ${te.name} 执行结果：${te.result}`)
              .join('\n\n');

            llmMessages.push({ role: 'assistant', content: fullContent });
            llmMessages.push({
              role: 'user',
              content: `以下是工具执行结果：\n\n${toolResultsSummary}\n\n请根据工具执行结果，用自然语言向用户总结并解释这些结果。`,
            });

            // Get continuation stream using the same provider
            let continueStreamIterator: AsyncGenerator<{ content?: string }>;

            if (useExtendedProvider && options.llmProviderBaseUrl && options.llmProviderApiKey) {
              const adapter = new LLMClientAdapter({
                baseUrl: options.llmProviderBaseUrl,
                apiKey: options.llmProviderApiKey,
                customHeaders: options.customHeaders,
              });

              const streamOptions = {
                model: llmModel,
                temperature: llmTemperature,
              };
              if (llmMaxTokens) {
                (streamOptions as Record<string, unknown>).max_tokens = llmMaxTokens;
              }

              continueStreamIterator = adapter.stream(llmMessages as Parameters<typeof adapter.stream>[0], streamOptions as Parameters<typeof adapter.stream>[1]);
            } else {
              const adapter = new LLMClientAdapter({
                baseUrl: process.env.COZE_BASE_URL || 'https://api.coze.cn',
                apiKey: process.env.COZE_API_KEY || '',
                customHeaders: options.customHeaders || {},
              });

              const streamOptions = {
                model: llmModel,
                temperature: llmTemperature,
              };
              if (llmMaxTokens) {
                (streamOptions as Record<string, unknown>).max_tokens = llmMaxTokens;
              }

              continueStreamIterator = adapter.stream(llmMessages as Parameters<typeof adapter.stream>[0], streamOptions as Parameters<typeof adapter.stream>[1]);
            }

            for await (const contChunk of continueStreamIterator) {
              if (contChunk.content) {
                const text = contChunk.content.toString();
                fullContent += text;
                // Strip internal markers before sending to client
                const safeText = stripInternalMarkers(text);
                if (safeText) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: safeText })}\n\n`));
                }
              }
            }
          }

          // Sub-agent delegation: detect [DELEGATE_TO] markers and process
          if (options.enableSubAgentDelegation && options.parentBotId) {
            const delegationMatches = [...fullContent.matchAll(DELEGATION_PATTERN)];
            if (delegationMatches.length > 0) {
              // Detect intent and route to best sub-agent
              const { matchedSubAgent, intent, confidence: routeConfidence } = await subAgentService.detectIntentAndRoute(
                options.parentBotId,
                userMessage,
              );

              if (matchedSubAgent && routeConfidence > 0.3) {
                try {
                  const result = await subAgentService.delegateTask({
                    conversation_id: conversationId,
                    parent_bot_id: options.parentBotId,
                    child_bot_id: matchedSubAgent.id,
                    trigger_intent: intent ?? undefined,
                    input_message: userMessage,
                  });

                  delegationResults.push({
                    childBotName: result.childBot.name,
                    responseContent: result.responseContent,
                    confidence: result.confidence,
                  });

                  // Send delegation event to client
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    delegation: {
                      child_bot_name: result.childBot.name,
                      child_bot_id: result.childBot.id,
                      intent,
                      confidence: result.confidence,
                      collaborations: result.collaborations?.length || 0,
                    },
                  })}\n\n`));

                  // Append sub-agent response to the content (strip internal markers as safety net)
                  const delegationContent = stripInternalMarkers(`\n\n---\n**${result.childBot.name}** 处理结果：\n${result.responseContent}`);
                  fullContent += delegationContent;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delegationContent })}\n\n`));
                } catch (delegationError) {
                  logger.agent.warn('Sub-agent delegation failed', { error: delegationError, conversationId });
                  // Don't fail the whole stream on delegation error
                }
              }

              // Clean up delegation markers from final content
              fullContent = fullContent.replace(DELEGATION_PATTERN, '');
            }
          }

          // P2: Claim verification — runs BEFORE confidence calculation so that hasKnowledge
          // reflects verified citations. This ensures SSE done.sources and confidence_breakdown
          // are always consistent. Verification failures result in empty knowledge sources.
          let claimVerificationResult: ClaimVerificationResult | null = null;
          if (options.claimVerificationConfig && options.evidenceCitations && options.evidenceCitations.length > 0) {
            const verifier = new ClaimSupportVerifier();
            // Cast PublicCitationItem[] to CitationItem[] — the streaming service is the
            // canonical producer of PublicCitationItem, so this is safe.
            claimVerificationResult = await verifier.verify(
              fullContent,
              options.evidenceCitations as CitationItem[],
              options.claimVerificationConfig
            );
          }

          // Calculate final confidence using weighted fusion
          // Weights: knowledge 40%, tool 30%, LLM self-eval 30%
          // When missing sources, redistribute weights accordingly
          const hasKnowledge = claimVerificationResult !== null
            ? claimVerificationResult.ok && claimVerificationResult.sources.length > 0
            : (knowledgeConfidence > 0);
          const hasTools = toolCallsData.length > 0;
          const hasSubAgentDelegation = delegationResults.length > 0;
          const subAgentDelegationConfidence = hasSubAgentDelegation
            ? delegationResults.reduce((sum, r) => sum + r.confidence, 0) / delegationResults.length
            : 0;

          // Use shared confidence calculation with content-based extraction
          const confidenceBreakdown = buildConfidenceFromContent(fullContent, {
            hasKnowledge,
            knowledgeConfidence,
            hasTools,
            toolExecutions: toolExecutions.map(te => ({ confidence: te.confidence })),
            llmSelfConfidence: 0, // Extracted from content by buildConfidenceFromContent
            hasSubAgentDelegation,
            subAgentDelegationConfidence,
          });

          // Strip self-eval tags from content after extraction
          fullContent = fullContent.replace(/\[CONF:[0-9]*\.?[0-9]+\]/g, '').trim();

          const overallConfidence = confidenceBreakdown.final;

          // P0 fix: sources MUST come from the orchestrator-graded evidenceCitations,
// NEVER from raw knowledgeSources (deprecated) and NEVER parsed from the
// knowledge context text via regex (which claimed citations without verifying
// claim support).
//
// The orchestrator already returns provenanceVersion=2 citations that have
// passed evidence grading. Auto-reply / sub-agent / tool sources are still
// added later by the caller (e.g. simulation route merges non-knowledge types).
if (options.evidenceCitations && options.evidenceCitations.length > 0) {
  for (const c of options.evidenceCitations) {
    sources.push({
      type: c.type,
      content: c.content,
      score: c.score,
      knowledge_item_id: c.knowledge_item_id,
      name: c.name,
      category: c.category,
      keyword: c.keyword,
      id: c.id,
      title: c.title,
      image_url: c.image_url,
      provenanceVersion: c.provenanceVersion,
      // P2: stable chunk identity fields
      chunk_id: c.chunk_id,
      chunk_index: c.chunk_index,
      content_hash: c.content_hash,
    } as PublicCitationItem);
  }
}

// Backwards-compat warning if a caller still passes raw knowledgeSources.
// We DO NOT promote them to public sources — the orchestrator contract is the
// single source of truth. The streaming service only logs the deprecation.
if (options.knowledgeSources && options.knowledgeSources.length > 0 && (!options.evidenceCitations || options.evidenceCitations.length === 0)) {
  logger.agent.warn(
    '[LLMStreamingService] Caller passed raw knowledgeSources without evidenceCitations. ' +
      'Raw candidates are not promoted to public citations. Migrate the caller to RetrievalOrchestrator.',
    { caller: conversationId, rawCount: options.knowledgeSources.length }
  );
}

// Provenance trace is logged for observability (and later trace persistence).
if (options.retrievalTrace) {
  logger.agent.debug('[LLMStreamingService] Retrieval trace', {
    caller: conversationId,
    trace: options.retrievalTrace,
  });
}

// P2: Apply claim verification results to the sources array.
// This runs AFTER the initial sources are built from evidenceCitations but BEFORE
// the done event, ensuring SSE done.sources and DB persistence are consistent.
// Claim verification NEVER adds sources — it can only remove knowledge sources.
if (claimVerificationResult !== null) {
  if (!claimVerificationResult.ok) {
    // Fail-closed: verification failed → remove all knowledge sources
    const nonKnowledgeSources = sources.filter(s => s.type !== 'knowledge');
    sources.length = 0;
    sources.push(...nonKnowledgeSources);
    logger.agent.debug('[LLMStreamingService] Claim verification failed, removing knowledge sources', {
      code: claimVerificationResult.code ?? 'unknown',
      originalKnowledgeCitations: options.evidenceCitations?.filter(c => c.type === 'knowledge').length ?? 0,
    });
  } else if (claimVerificationResult.sources.length > 0) {
    // Partial success: keep only the verified sources (may be fewer than original)
    const verifiedChunkIds = new Set(
      claimVerificationResult.sources.map(s => (s as { chunk_id?: string | null }).chunk_id)
    );
    const verifiedSources = sources.filter(
      s => s.type !== 'knowledge' || verifiedChunkIds.has((s as { chunk_id?: string | null }).chunk_id)
    );
    sources.length = 0;
    sources.push(...verifiedSources);
    logger.agent.debug('[LLMStreamingService] Claim verification: partial', {
      originalCitations: options.evidenceCitations?.filter(c => c.type === 'knowledge').length ?? 0,
      verifiedCitations: claimVerificationResult.sources.length,
    });
  }
  // Full success: no change needed (all knowledge citations remain)
}

          // Extract image references from LLM output: [IMG:url](alt)
          const extractedImages: Array<{ url: string; alt: string }> = [];
          let imageMatch;
          const imageRefRegex = new RegExp(IMAGE_REF_PATTERN.source, IMAGE_REF_PATTERN.flags);
          while ((imageMatch = imageRefRegex.exec(fullContent)) !== null) {
            extractedImages.push({ url: imageMatch[1], alt: imageMatch[2] });
          }

          // Strip all internal markers from final content before storing/sending to client.
          // Note: TOOL_CALL markers have already been filtered from streamed output above,
          // but may still be present in fullContent (e.g. from continuation stream).
          // CONF markers were stripped after conf parsing above.
          // DELEGATE markers were stripped after delegation processing above.
          // This is a safety net — remove any remaining internal markers before DB persist and done event.
          fullContent = stripInternalMarkers(fullContent);

          // Send extracted images as separate SSE event before final done
          if (extractedImages.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              images: extractedImages,
            })}\n\n`));
          }

          // Send final event with metadata
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            done: true,
            sources,
            confidence: overallConfidence,
            confidence_breakdown: confidenceBreakdown,
            tool_calls: toolCallsData.length > 0 ? toolCallsData : undefined,
            delegations: delegationResults.length > 0 ? delegationResults : undefined,
            images: extractedImages.length > 0 ? extractedImages : undefined,
            botId: options.parentBotId,
            botName: options.parentBotName,
          })}\n\n`));

          // Post-stream operations (fire-and-forget, non-blocking)
          handlePostStreamOperations(
            conversationId,
            userMessage,
            fullContent,
            overallConfidence,
            toolCallsData,
            sources,
            customHeaders,
            extractedImages,
            confidenceBreakdown,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : '生成回复失败';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
        } finally {
          controller.close();
        }
      },
      cancel() {
        // Client disconnected — abort ongoing LLM stream
        isAborted = true;
      },
    });

    return stream;
  }

  /**
   * Handle post-stream operations:
   * 1. Insert assistant message
   * 2. Generate summary (fire-and-forget)
   * 3. Check alerts
   */
  private async handlePostStreamOperations(
    conversationId: string,
    userMessage: string,
    fullContent: string,
    overallConfidence: number,
    toolCallsData: Array<{ name: string; args: Record<string, unknown>; result: string }>,
    sources: PublicCitationItem[],
    customHeaders: Record<string, string>,
    extractedImages?: Array<{ url: string; alt: string }>,
    confidenceBreakdown?: ConfidenceBreakdown,
  ): Promise<void> {
    try {
      // 1. Insert assistant message with confidence, tool calls, and knowledge images
      // Skip for in-memory simulation conversations (no DB row → FK violation);
      // simulation route saves the message via simulationRepository instead.
      if (conversationId.startsWith('sim-')) {
        logger.agent.debug('[LLMStreamingService] Skipping DB persistence for simulation', { conversationId });
        return;
      }

      const knowledgeImages = extractedImages && extractedImages.length > 0 ? extractedImages : undefined;
      await this.conversationService.insertMessage({
        conversation_id: conversationId,
        role: 'assistant' as const,
        content: fullContent,
        confidence: overallConfidence,
        sources: sources.length > 0 ? sources : null,
        tool_calls: toolCallsData.length > 0 ? toolCallsData : null,
        message_type: knowledgeImages ? 'knowledge_images' : undefined,
        rich_content: knowledgeImages ? { type: 'knowledge_images', data: {}, images: knowledgeImages } : undefined,
        confidence_breakdown: confidenceBreakdown ?? null,
      });

      // 1.5 Update message count for the assistant message
      // (insertMessage only writes the row; count increment is separate)
      this.conversationService.incrementMessageCount(conversationId).catch((err) => {
        logger.agent.warn('[LLMStreamingService] Failed to increment message count', { error: err, conversationId });
      });

      // 2. Generate incremental summary (fire-and-forget, non-blocking)
      this.summaryService.generateIncrementalSummary(
        conversationId,
        userMessage,
        fullContent,
        customHeaders,
      ).catch((err) => {
        logger.agent.warn('[LLMStreamingService] Failed to generate incremental summary', { error: err, conversationId });
      });

      // 3. Check for anomalies and create alerts
      // Skip for in-memory simulation conversations (no DB row → FK violation on alerts insert)
      if (!conversationId.startsWith('sim-')) {
        const messageCount = await this.conversationService.countMessages(conversationId);
        await this.alertService.checkAndCreateConversationAlerts(
          conversationId,
          overallConfidence,
          messageCount,
        );
      }

      // 4. Run quality checks against AI reply and create alerts for failures (fire-and-forget, non-blocking)
      // Fetch conversation info to build the complete quality check context
      const runQualityCheck = async () => {
        try {
          // Skip quality checks for in-memory simulation conversations (no DB row → FK violation)
          if (conversationId.startsWith('sim-')) {
            return;
          }
          const sessionInfo = await this.conversationService.getSessionInfo(conversationId);
          const messageCount = await this.conversationService.countMessages(conversationId);
          const firstAssistantReplyAt = await this.conversationService.getFirstAssistantReplyAt(conversationId);
          const qualityContext: QualityCheckContext = {
            conversationId,
            aiReplyContent: fullContent,
            messageCount: sessionInfo?.message_count ?? messageCount,
            aiReplyCreatedAt: new Date().toISOString(),
            conversationCreatedAt: sessionInfo?.created_at ?? new Date().toISOString(),
            firstAssistantReplyAt,
          };
          const qualityResults: QualityCheckResult[] = await this.qualityService.runQualityCheck(qualityContext);

          // Create alerts for failed quality checks
          for (const result of qualityResults) {
            if (result.result === 'fail') {
              await this.alertService.createQualityFailedAlert(
                conversationId,
                result.ruleName,
                result.ruleType,
                result.detail,
              );
            }
          }
        } catch (err) {
          logger.agent.warn('[LLMStreamingService] Failed to run quality check', { error: err, conversationId });
        }
      };
      runQualityCheck();

      // 5. Detect & record knowledge gaps (fire-and-forget, non-blocking).
      //    Conditions: no sources, all sources below score floor, or handoff triggered.
      this.recordKnowledgeGapIfAny(
        conversationId,
        userMessage,
        sources,
        overallConfidence,
      ).catch((err) => {
        logger.agent.warn('[LLMStreamingService] Failed to record knowledge gap', { error: err, conversationId });
      });
    } catch (error) {
      // Log but don't fail - these are secondary operations
      logger.agent.error('Post-stream operations failed', { error, conversationId });
    }
  }

  /**
   * Detect whether the current exchange reveals a knowledge gap, and if so record it.
   * Best-effort and non-blocking: any failure is swallowed at the caller.
   */
  private async recordKnowledgeGapIfAny(
    conversationId: string,
    userMessage: string,
    sources: PublicCitationItem[],
    overallConfidence: number,
  ): Promise<void> {
    // Skip: in-memory simulation conversations have no DB row → FK violation on insert
    if (conversationId.startsWith('sim-')) {
      return;
    }

    // Quick skip: if sources are non-empty and confidence is reasonable, almost certainly not a gap
    if (sources.length > 0 && overallConfidence >= 0.5) {
      // Still possible (e.g. all sources scored < 0.5), let the service decide
    }

    // Look up conversation handoff state in parallel-friendly way
    const session = await this.conversationService.getSessionInfo(conversationId).catch((err) => {
      logger.agent.warn('[LLMStreamingService] Failed to get session info for gap detection', { error: err, conversationId });
      return null;
    });
    const triggeredHandoff = session?.status === 'handoff';

    await this.knowledgeGapService.analyzeAndRecord({
      userQuestion: userMessage,
      sources: sources as never,
      triggeredHandoff,
      conversationId,
    });
  }

  /**
   * Build LLM messages array from history and context.
   * SECURITY: Strips tool call patterns from user messages to prevent prompt injection.
   */
  buildLLMMessages(
    userMessage: string,
    historyMessages: MessageHistoryItem[],
    knowledgeContext?: string,
    imageUrl?: string | null,
    knowledgeMinScore: number = 0.75,
    enableSubAgentDelegation: boolean = false,
    customSystemPrompt?: string,
    knowledgeImages?: KnowledgeImageRef[],
    productContext?: string,
    sizeChartContext?: string,
  ): LLMMessage[] {
    // Use custom system prompt from settings if provided, otherwise use default
    const baseSystemPrompt = customSystemPrompt || SYSTEM_PROMPT;
    let systemPrompt = baseSystemPrompt + TOOL_SYSTEM_PROMPT + CONFIDENCE_SELF_EVAL_PROMPT;

    // Add sub-agent delegation prompt if enabled
    if (enableSubAgentDelegation) {
      systemPrompt += SUB_AGENT_DELEGATION_PROMPT;
    }

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (knowledgeContext) {
      (llmMessages[0].content as string) += `\n\n以下是从知识库检索到的相关资料，请优先参考这些内容回答用户问题：\n\n${knowledgeContext}`;
    } else {
      (llmMessages[0].content as string) += `\n\n注意：知识库中未找到与用户问题高度相关的资料（相关度阈值 ${knowledgeMinScore}），请基于通用知识回答，并建议用户咨询人工客服获取更准确信息。`;
    }

    // Add knowledge image references if available
    if (knowledgeImages && knowledgeImages.length > 0) {
      (llmMessages[0].content as string) += KNOWLEDGE_IMAGE_PROMPT;
      const imageList = knowledgeImages
        .map((img, i) => `图片${i + 1}: ${img.url}（${img.name}，分类：${img.category}）`)
        .join('\n');
      (llmMessages[0].content as string) += `\n\n知识库中找到以下相关图片，你可以在回复中使用 [IMG:URL](描述) 格式引用：\n${imageList}`;
    }

    // Add product context if available
    if (productContext) {
      (llmMessages[0].content as string) += `\n\n以下是商品详情信息，请结合商品规格和描述回答用户问题：\n\n${productContext}`;
    }

    // Add size chart context if available
    if (sizeChartContext) {
      (llmMessages[0].content as string) += `\n\n以下是尺码表信息，当用户询问尺码、尺码推荐或尺码对比时，请优先参考这些内容：\n\n${sizeChartContext}`;
    }

    // Add image understanding prompt if image is present
    if (imageUrl) {
      (llmMessages[0].content as string) += IMAGE_UNDERSTANDING_PROMPT;
    }

    // Add history messages (strip tool call patterns from user messages)
    if (historyMessages && historyMessages.length > 0) {
      const recentHistory = historyMessages.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          // Strip tool call patterns from user messages for security
          const content = msg.role === 'user'
            ? stripToolCallPatternsFromUser(msg.content)
            : msg.content;

          // If the user message has an image, construct multimodal content
          if (msg.role === 'user' && msg.image_url) {
            llmMessages.push({
              role: 'user',
              content: [
                { type: 'text', text: content },
                { type: 'image_url', image_url: { url: msg.image_url, detail: 'high' } },
              ],
            });
          } else {
            llmMessages.push({ role: msg.role as 'user' | 'assistant', content });
          }
        }
      }
    }

    // If current message has an image but wasn't in history yet, add it
    const lastHistoryMsg = historyMessages?.[historyMessages.length - 1];
    const lastMsgHasImage = lastHistoryMsg && lastHistoryMsg.role === 'user' && lastHistoryMsg.image_url;
    if (imageUrl && !lastMsgHasImage) {
      // Strip tool call patterns from current user message for security
      const safeUserMessage = stripToolCallPatternsFromUser(userMessage);
      llmMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: safeUserMessage },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
        ],
      });
    }

    return llmMessages;
  }
}

/**
 * Strip tool call patterns from user input to prevent prompt injection attacks.
 * Only parses tool calls from assistant content in the stream.
 */
function stripToolCallPatternsFromUser(text: string): string {
  return text.replace(TOOL_CALL_PATTERN, '[工具调用已过滤]').replace(DELEGATION_PATTERN, '[委派标记已过滤]');
}

/**
 * Parse tool calls from LLM output, verify authorization, and execute them.
 * Authorization is checked for sensitive tools (refund, modify_address).
 */
async function parseAndExecuteToolCalls(
  content: string,
  toolExecution: ToolExecutionService,
  conversationId: string,
): Promise<Array<{ name: string; args: Record<string, unknown>; result: string; confidence: number }>> {
  const toolExecutions: Array<{ name: string; args: Record<string, unknown>; result: string; confidence: number }> = [];
  const toolCallRegex = /\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g;
  let match: RegExpExecArray | null;

  while ((match = toolCallRegex.exec(content)) !== null) {
    const toolName = match[1];
    const argsStr = match[2];
    try {
      const args = JSON.parse(argsStr);

      // Verify authorization before executing
      try {
        await toolExecution.verifyToolAuthorization(conversationId, toolName, args);
      } catch (authError) {
        const authMsg = authError instanceof Error ? authError.message : 'Authorization failed';
        toolExecutions.push({
          name: toolName,
          args,
          result: `工具 ${toolName} 执行被拒绝：${authMsg}`,
          confidence: 0.1,
        });
        continue;
      }

      const toolResult = await toolExecution.executeTool(toolName, args);
      toolExecutions.push({ name: toolName, args, result: toolResult.result, confidence: toolResult.confidence });
    } catch (err) {
      logger.warn('Tool call parse failed', { toolName, error: String(err) });
    }
  }

  return toolExecutions;
}
