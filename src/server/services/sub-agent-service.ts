import { BotConfigRepository, type BotConfigRow } from '@/server/repositories/bot-config-repository';
import { LLMClientAdapter } from './llm-client-adapter';
import { ToolExecutionService } from './tool-execution-service';
import {
  SubAgentRepository,
  type AgentDelegationRow,
  type AgentCollaborationRow,
  type CreateDelegationInput,
  type CreateCollaborationInput,
} from '@/server/repositories/sub-agent-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { ServiceError } from './service-error';
import { logger } from '@/lib/logger';


// Normalize text to prevent zero-width character bypass attacks
function normalizeText(text: string): string {
    if (!text) return '';
    return text
        .normalize('NFC')
        .replace(/[​-‏﻿­]/g, '');
}

function toServiceError(error: unknown, fallbackMessage: string, fallbackCode: string): ServiceError {
    if (error instanceof ServiceError) return error;
    const message = error instanceof Error ? error.message : fallbackMessage;
    return new ServiceError(message, { status: 500, code: fallbackCode });
}


// Intent categories for sub-agent routing
const INTENT_CATEGORIES: Record<string, string[]> = {
  order_query: ['订单', '查询订单', '订单状态', '到哪了', '物流', '快递', '发货', '收货', '订单号', '修改地址', '取消订单'],
  refund_request: ['退款', '退钱', '退款进度', '退款状态', '退款查询'],
  after_sales: ['换货', '退货', '维权', '投诉', '质量问题', '破损', '瑕疵', '假货', '维修', '售后'],
};

// Tool-call protocol prompt segment (mirrors llm-streaming-service.ts)
const TOOL_CALLS_GUIDE = `[TOOL_CALL]工具名|参数JSON[/TOOL_CALL]

当需要执行操作时，在回复末尾添加工具调用，格式如下：

[TOOL_CALL]工具名|参数JSON[/TOOL_CALL]

可用工具：
1. query_order_status - 查询订单状态（参数：order_id）
2. query_logistics - 查询物流进度（参数：tracking_number）
3. apply_refund - 申请退款（参数：order_id, reason, amount?）
4. modify_shipping_address - 修改收货地址（参数：order_id, new_address, new_name?, new_phone?）
5. query_product_detail - 查询商品详情（参数：sku?/name?/product_id?）
6. query_size_chart - 查询尺码表（参数：sku?/category?/name?/size_chart_id?）

重要提示：
- 只在确实需要执行操作时才使用工具调用
- 工具调用会阻塞回复直到获得结果，请等待结果后再继续回复
- 如果用户只是询问信息，可以直接回答，不需要使用工具`;

export interface DelegationResult {
  delegation: AgentDelegationRow;
  childBot: BotConfigRow;
  responseContent: string;
  confidence: number;
  collaborations?: AgentCollaborationRow[];
  degraded?: boolean;
}

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface CollaborationRequest {
  senderBotId: string;
  receiverBotId: string;
  messageType: 'request' | 'response' | 'notify';
  content: string;
  context?: Record<string, unknown>;
}

const MAX_SUB_AGENTS_PER_BOT = 10;
const DEFAULT_MAX_MAIN_BOTS = 10;
const MAX_MAIN_BOTS_SETTING_KEY = 'max_main_bots';

/**
 * Read the configured main-bot cap from the settings table. Mirrors the
 * DB trigger (20260710_main_bot_cap_trigger.sql): a missing or non-numeric
 * value falls back to the factory default of 10. Range-clamped to
 * [1, 1000] to prevent typos from disabling the cap entirely.
 */
async function readMainBotCap(): Promise<number> {
  try {
    const settingsRepo = new SettingsRepository();
    const raw = await settingsRepo.get(MAX_MAIN_BOTS_SETTING_KEY);
    if (raw == null || raw === '') return DEFAULT_MAX_MAIN_BOTS;
    const parsed = parseInt(String(raw), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_MAIN_BOTS;
    return Math.min(Math.max(parsed, 1), 1000);
  } catch (err) {
    logger.warn('[SubAgentService] Failed to read max_main_bots setting, using default', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_MAX_MAIN_BOTS;
  }
}

export class SubAgentService {
  private readonly botConfigRepo = new BotConfigRepository();
  private readonly subAgentRepo = new SubAgentRepository();
  private readonly toolExecution = new ToolExecutionService();

  /**
   * Count sub-agents whose status is "active" under a parent bot.
   * Disabled sub-agents do not count against the per-parent quota so admins
   * can re-enable / replace them without bumping into the cap.
   */
  async countActiveSubAgents(parentBotId: string): Promise<number> {
    try {
      const all = await this.botConfigRepo.listSubAgents(parentBotId);
      return all.filter((a) => a.status === 'active').length;
    } catch (error) {
      throw toServiceError(error, '查询子Agent数量失败', 'DB_ERROR');
    }
  }

  /**
   * Assert that the global main-bot count has not yet reached the cap.
   * Throws ServiceError(MAX_MAIN_BOTS_EXCEEDED) when the total active
   * main-bot count already equals or exceeds the configured cap.
   *
   * The cap is read from `settings.max_main_bots` so operators can raise
   * or lower the limit without a code change. The DB trigger enforces the
   * same rule as defense-in-depth, so a missed settings refresh here is
   * still caught at INSERT time.
   */
  async assertMainBotQuotaAvailable(): Promise<void> {
    const cap = await readMainBotCap();
    const count = await this.botConfigRepo.countMainBots();
    if (count >= cap) {
      // Use the shared ServiceError so cross-module `instanceof` checks
      // (e.g. BotConfigService) recognize this throw without re-wrapping.
      throw new ServiceError(
        `系统最多只能创建 ${cap} 个主Bot，当前已有 ${count} 个，请删除或停用现有主Bot后再试`,
        { status: 400, code: 'MAX_MAIN_BOTS_EXCEEDED' }
      );
    }
  }

  /**
   * Throws ServiceError(MAX_SUB_AGENTS_EXCEEDED) when the active sub-agent
   * count for `parentBotId` has already reached the per-parent cap.
   * Reused by every sub-agent creation entry point (sub-agent POST, generic
   * bot POST with is_sub_agent=true, and PUT that flips a bot into a
   * sub-agent) so the cap cannot be bypassed via the alternate API path.
   */
  async assertSubAgentQuotaAvailable(parentBotId: string): Promise<void> {
    const parentBot = await this.botConfigRepo.findById(parentBotId);
    if (!parentBot) {
      throw new ServiceError('父Bot不存在', { status: 404, code: 'NOT_FOUND' });
    }
    if (parentBot.is_sub_agent) {
      throw new ServiceError('子Agent不能作为父Bot', { status: 400, code: 'VALIDATION_ERROR' });
    }
    const activeCount = await this.countActiveSubAgents(parentBotId);
    if (activeCount >= MAX_SUB_AGENTS_PER_BOT) {
      throw new ServiceError(
        `每个主Bot最多只能创建 ${MAX_SUB_AGENTS_PER_BOT} 个子Agent，当前已有 ${activeCount} 个`,
        { status: 400, code: 'MAX_SUB_AGENTS_EXCEEDED' }
      );
    }
  }

  /**
   * List all sub-agents under a parent bot
   */
  async listSubAgents(parentBotId: string): Promise<{ subAgents: BotConfigRow[]; parentBot: BotConfigRow }> {
    try {
      const parentBot = await this.botConfigRepo.findById(parentBotId);
      if (!parentBot) {
        throw new ServiceError('父Bot不存在', { status: 404, code: 'NOT_FOUND' });
      }
      const subAgents = await this.botConfigRepo.listSubAgents(parentBotId);
      return { subAgents, parentBot };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '获取子Agent列表失败', 'DB_ERROR');
    }
  }

  /**
   * Create a new sub-agent under a parent bot
   */
  async createSubAgent(input: {
    parent_bot_id: string;
    name: string;
    description?: string;
    system_prompt: string;
    tools?: unknown[];
    knowledge_ids?: string[];
    delegation_prompt?: string;
    collaboration_config?: Record<string, unknown>;
  }): Promise<{ subAgent: BotConfigRow }> {
    try {
      // Quota + parent validity checks (active-only) live in the shared helper
      // so the /api/bot-configs POST bypass gets the same enforcement.
      await this.assertSubAgentQuotaAvailable(input.parent_bot_id);

      const subAgent = await this.botConfigRepo.create({
        name: input.name,
        description: input.description,
        system_prompt: input.system_prompt,
        tools: input.tools ?? [],
        knowledge_ids: input.knowledge_ids ?? [],
        parent_bot_id: input.parent_bot_id,
        delegation_prompt: input.delegation_prompt,
        collaboration_config: input.collaboration_config ?? null,
        is_sub_agent: true,
        is_default: false,
      });

      return { subAgent };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '创建子Agent失败', 'DB_ERROR');
    }
  }

  /**
   * Update a sub-agent's configuration
   */
  async updateSubAgent(input: {
    id: string;
    name?: string;
    description?: string;
    system_prompt?: string;
    tools?: unknown[];
    knowledge_ids?: string[];
    delegation_prompt?: string;
    collaboration_config?: Record<string, unknown>;
    status?: string;
  }): Promise<{ subAgent: BotConfigRow }> {
    try {
      const existing = await this.botConfigRepo.findById(input.id);
      if (!existing) {
        throw new ServiceError('子Agent不存在', { status: 404, code: 'NOT_FOUND' });
      }
      if (!existing.is_sub_agent) {
        throw new ServiceError('目标不是子Agent', { status: 400, code: 'VALIDATION_ERROR' });
      }

      const subAgent = await this.botConfigRepo.update({
        id: input.id,
        name: input.name,
        description: input.description,
        system_prompt: input.system_prompt,
        tools: input.tools,
        knowledge_ids: input.knowledge_ids,
        delegation_prompt: input.delegation_prompt,
        collaboration_config: input.collaboration_config,
        status: input.status,
      });

      return { subAgent };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '更新子Agent失败', 'DB_ERROR');
    }
  }

  /**
   * Delete a sub-agent
   */
  async deleteSubAgent(id: string): Promise<void> {
    try {
      const existing = await this.botConfigRepo.findById(id);
      if (!existing) {
        throw new ServiceError('子Agent不存在', { status: 404, code: 'NOT_FOUND' });
      }
      if (!existing.is_sub_agent) {
        throw new ServiceError('目标不是子Agent', { status: 400, code: 'VALIDATION_ERROR' });
      }
      await this.botConfigRepo.delete(id);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '删除子Agent失败', 'DB_ERROR');
    }
  }

  /**
   * Detect the intent of a user message and find the best matching sub-agent
   */
  async detectIntentAndRoute(
    parentBotId: string,
    userMessage: string,
  ): Promise<{ matchedSubAgent: BotConfigRow | null; intent: string | null; confidence: number }> {
    const subAgents = await this.botConfigRepo.listSubAgents(parentBotId);
    if (subAgents.length === 0) {
      return { matchedSubAgent: null, intent: null, confidence: 0 };
    }

    // 1. Keyword-based intent detection
    let bestMatch: BotConfigRow | null = null;
    let bestIntent: string | null = null;
    let bestScore = 0;

    const normalizedMessage = normalizeText(userMessage);

    for (const subAgent of subAgents) {
      if (subAgent.status !== 'active') continue;

      // Check delegation_prompt for intent keywords
      const delegationKeywords = normalizeText(subAgent.delegation_prompt || '');
      const subAgentName = normalizeText(subAgent.name);

      // Score based on INTENT_CATEGORIES matching
      for (const [intent, keywords] of Object.entries(INTENT_CATEGORIES)) {
        const normalizedKeywords = keywords.map(normalizeText);
        const matchCount = normalizedKeywords.filter(kw => normalizedMessage.includes(kw)).length;
        if (matchCount > 0) {
          // Check if this sub-agent's delegation_prompt or name relates to this intent
          const delegationRelevance = normalizedKeywords.filter(kw => delegationKeywords.includes(kw) || subAgentName.includes(kw)).length;
          const score = (matchCount * 0.3) + (delegationRelevance * 0.7);

          if (score > bestScore) {
            bestScore = score;
            bestMatch = subAgent;
            bestIntent = intent;
          }
        }
      }
    }

    // 2. If no keyword match, try delegation_prompt semantic matching
    if (!bestMatch) {
      for (const subAgent of subAgents) {
        if (subAgent.status !== 'active' || !subAgent.delegation_prompt) continue;

        // Simple keyword overlap scoring
        const normalizedPrompt = normalizeText(subAgent.delegation_prompt);
        const promptWords = normalizedPrompt.split(/[，,、\s]+/).filter(w => w.length > 1);
        const messageWords = normalizedMessage.split(/\s+/);
        const overlap = promptWords.filter(w => messageWords.some(mw => mw.includes(w) || w.includes(mw))).length;

        if (overlap > 0 && overlap / promptWords.length > 0.2) {
          const score = overlap / promptWords.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = subAgent;
            bestIntent = 'semantic_match';
          }
        }
      }
    }

    return {
      matchedSubAgent: bestMatch,
      intent: bestIntent,
      confidence: Math.min(bestScore, 1.0),
    };
  }

  /**
   * Delegate a task to a sub-agent
   * This creates a delegation record and processes it
   */
  async delegateTask(input: {
    conversation_id: string;
    parent_bot_id: string;
    child_bot_id: string;
    trigger_intent?: string;
    input_message: string;
    /** R-2: 商品上下文（注入到子Agent系统提示词） */
    productContext?: string;
    /** R-2: 尺码表上下文（注入到子Agent系统提示词） */
    sizeChartContext?: string;
    /** R-2: 子Agent专属的LLM Provider配置（覆盖默认Coze配置） */
    llmProviderConfig?: LlmProviderConfig;
  }): Promise<DelegationResult> {
    try {
      // Verify parent and child bots exist
      const parentBot = await this.botConfigRepo.findById(input.parent_bot_id);
      if (!parentBot) {
        throw new ServiceError('父Bot不存在', { status: 404, code: 'NOT_FOUND' });
      }

      const childBot = await this.botConfigRepo.findById(input.child_bot_id);
      if (!childBot) {
        throw new ServiceError('子Agent不存在', { status: 404, code: 'NOT_FOUND' });
      }
      if (childBot.parent_bot_id !== input.parent_bot_id) {
        throw new ServiceError('子Agent不属于指定的父Bot', { status: 400, code: 'VALIDATION_ERROR' });
      }

      // Create delegation record
      const delegation = await this.subAgentRepo.createDelegation({
        conversation_id: input.conversation_id,
        parent_bot_id: input.parent_bot_id,
        child_bot_id: input.child_bot_id,
        trigger_intent: input.trigger_intent,
        input_message: input.input_message,
        metadata: { child_bot_name: childBot.name },
      });

      // Update status to processing
      await this.subAgentRepo.updateDelegationStatus(delegation.id, 'processing');

      // Build the sub-agent response prompt
      const { content: responseContent, degraded } = await this.generateSubAgentResponse(
        childBot,
        input.conversation_id,
        input.input_message,
        input.productContext,
        input.sizeChartContext,
        input.llmProviderConfig,
      );

      // Calculate confidence based on sub-agent's configuration and actual response quality
      // P2-A: degraded=true → force confidence to 0.3 (below alert threshold 0.4, triggers human handoff)
      const hasExternalContext = !!(input.productContext || input.sizeChartContext);
      const confidence = degraded
        ? 0.3
        : this.calculateSubAgentConfidence(
            childBot,
            input.input_message,
            responseContent,
            hasExternalContext,
          );

      // Complete the delegation
      const completedDelegation = await this.subAgentRepo.updateDelegationStatus(delegation.id, 'completed', {
        result_content: responseContent,
        confidence,
        metadata: { child_bot_name: childBot.name, tools_available: childBot.tools },
      });

      // Handle collaboration if the sub-agent needs info from other sub-agents
      const collaborations = await this.handleCollaboration(
        input.conversation_id,
        completedDelegation.id,
        childBot,
        input.input_message,
        responseContent,
      );

      return {
        delegation: completedDelegation,
        childBot,
        responseContent,
        confidence,
        collaborations,
        degraded,
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '委派任务失败', 'DELEGATION_ERROR');
    }
  }

  /**
   * Generate a response from a sub-agent using the LLM.
   * Full pipeline: LLM → parse [TOOL_CALL] → execute via ToolExecutionService → second-pass LLM explanation.
   * Returns structured result with degraded flag for confidence calculation.
   *
   * @param productContext - Optional product context to inject into system prompt (R-2)
   * @param sizeChartContext - Optional size chart context to inject into system prompt (R-2)
   * @param llmProviderConfig - Optional LLM provider config to override the default Coze config (R-2)
   */
  private async generateSubAgentResponse(
    childBot: BotConfigRow,
    conversationId: string,
    userMessage: string,
    productContext?: string,
    sizeChartContext?: string,
    llmProviderConfig?: LlmProviderConfig,
  ): Promise<{ content: string; degraded: boolean }> {
    // R-2: Use the provided LLM provider config if available, otherwise fall back to env defaults
    const baseUrl = llmProviderConfig?.baseUrl ?? process.env.COZE_BASE_URL ?? 'https://api.coze.cn';
    const apiKey = llmProviderConfig?.apiKey ?? process.env.COZE_API_KEY;

    if (!apiKey) {
      throw new Error('Sub-agent LLM 调用失败: COZE_API_KEY 环境变量未配置');
    }

    const adapter = new LLMClientAdapter({ baseUrl, apiKey });
    const model = llmProviderConfig?.model ?? process.env.COZE_SUB_AGENT_MODEL ?? 'doubao-seed-2-0-lite-260215';

    let systemPrompt = childBot.system_prompt || '你是一个专业的客服助手。';

    // R-2: Inject external grounding context into system prompt
    if (productContext) {
      systemPrompt += `\n\n【商品详情信息】\n${productContext}`;
    }
    if (sizeChartContext) {
      systemPrompt += `\n\n【尺码表信息】\n${sizeChartContext}`;
    }

    const hasTools = Array.isArray(childBot.tools) && childBot.tools.length > 0;

    // Build system prompt with tool definitions (if tools are configured)
    const toolDefinitions = this.buildToolDefinitions(childBot.tools);
    const systemContent = toolDefinitions
      ? `${systemPrompt}\n\n${TOOL_CALLS_GUIDE}\n\n${toolDefinitions}`
      : systemPrompt;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userMessage },
    ];

    // First-pass LLM call
    let llmContent = '';
    try {
      const stream = adapter.stream(messages, { model, temperature: 0.7 });
      for await (const chunk of stream) {
        if (chunk.content) llmContent += chunk.content;
      }
    } catch (error) {
      logger.error('[SubAgentService] LLM first-pass failed', { error: error instanceof Error ? error.message : String(error) });
      return { content: this.buildFallbackResponse(childBot), degraded: true };
    }

    if (!llmContent.trim()) {
      return { content: this.buildFallbackResponse(childBot), degraded: true };
    }

    // If no tools are configured, return raw LLM response
    if (!hasTools) {
      return { content: llmContent, degraded: false };
    }

    // Parse and execute tool calls
    const toolExecutions = await this.parseAndExecuteToolCalls(llmContent, conversationId);

    if (toolExecutions.length === 0) {
      return { content: llmContent, degraded: false };
    }

    // Build second-pass LLM call with tool results
    const toolResultsSummary = toolExecutions
      .map((te) => `工具 ${te.name} 执行结果：${te.result}`)
      .join('\n\n');

    messages.push({ role: 'assistant', content: llmContent });
    messages.push({
      role: 'user',
      content: `以下是工具执行结果：\n\n${toolResultsSummary}\n\n请根据工具执行结果，用自然语言向用户总结并解释这些结果。`,
    });

    // Second-pass LLM call for natural language explanation
    let finalContent = '';
    try {
      const stream2 = adapter.stream(messages, { model, temperature: 0.7 });
      for await (const chunk of stream2) {
        if (chunk.content) finalContent += chunk.content;
      }
    } catch (error) {
      logger.warn('[SubAgentService] LLM second-pass failed, returning raw response', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Graceful degradation: return first-pass LLM content + raw tool results
      return { content: `${llmContent}\n\n---\n${toolResultsSummary}`, degraded: false };
    }

    return { content: finalContent.trim() || llmContent, degraded: false };
  }

  private buildFallbackResponse(childBot: BotConfigRow): string {
    const toolList = Array.isArray(childBot.tools)
      ? childBot.tools.map((t) => {
          const toolLabels: Record<string, string> = {
            query_order_status: '查询订单',
            query_logistics: '查询物流',
            apply_refund: '申请退款',
            query_product_detail: '查询商品',
            query_size_chart: '查询尺码表',
          };
          return toolLabels[String(t)] || String(t);
        }).join('、')
      : '无';

    return `[子Agent「${childBot.name}」处理中]\n${childBot.description}\n\n降级为模板回复：抱歉，专家正在处理您的问题，请稍候。`;
  }

  private buildToolDefinitions(tools: unknown[]): string | null {
    if (!Array.isArray(tools) || tools.length === 0) return null;

    const toolDefs = this.toolExecution.getAvailableTools();
    const availableNames = new Set(tools.map((t) => String(t)));
    const relevant = toolDefs.filter((def) => availableNames.has(def.name));

    if (relevant.length === 0) return null;

    const lines = relevant.map((def) => {
      const paramLines = Object.entries(def.parameters)
        .map(([key, info]) => `  - ${key}: ${(info as { description: string }).description}`)
        .join('\n');
      return `- ${def.name}: ${def.description}\n${paramLines}`;
    });

    return `【可用工具】（如需要请在回复末尾使用）：\n${lines.join('\n\n')}`;
  }

  private async parseAndExecuteToolCalls(
    content: string,
    conversationId: string,
  ): Promise<Array<{ name: string; args: Record<string, unknown>; result: string }>> {
    const results: Array<{ name: string; args: Record<string, unknown>; result: string }> = [];
    const toolCallRegex = /\[TOOL_CALL\](\w+)\|(.+?)\[\/TOOL_CALL\]/g;
    let match: RegExpExecArray | null;

    while ((match = toolCallRegex.exec(content)) !== null) {
      const toolName = match[1];
      const argsStr = match[2];
      try {
        const args = JSON.parse(argsStr);
        // Verify authorization for sensitive tools
        try {
          await this.toolExecution.verifyToolAuthorization(conversationId, toolName, args);
        } catch (authError) {
          const authMsg = authError instanceof Error ? authError.message : '授权失败';
          results.push({ name: toolName, args, result: `工具 ${toolName} 执行被拒绝：${authMsg}` });
          continue;
        }
        const execResult = await this.toolExecution.executeTool(toolName, args);
        results.push({ name: toolName, args, result: execResult.result });
      } catch (err) {
        logger.warn('[SubAgentService] Tool call parse/execute failed', { toolName, error: String(err) });
      }
    }

    return results;
  }

  /**
   * Calculate the confidence score for a sub-agent's response.
   * Evaluates both static configuration (tools, knowledge) and actual response quality.
   *
   * @param hasExternalContext - R-2: whether productContext or sizeChartContext was injected.
   *                             Adds +0.07 when true (OR logic — only once, not twice).
   */
  private calculateSubAgentConfidence(
    childBot: BotConfigRow,
    userMessage: string,
    responseContent: string,
    hasExternalContext: boolean = false,
  ): number {
    let confidence = 0.5; // Base confidence

    // Configuration signals (reduced weight from original — these are just potential, not proof)
    if (Array.isArray(childBot.tools) && childBot.tools.length > 0) {
      confidence += 0.05;
    }
    if (Array.isArray(childBot.knowledge_ids) && childBot.knowledge_ids.length > 0) {
      confidence += 0.05;
    }

    // R-2: External grounding (product / size-chart) boosts confidence by 0.07.
    // Applied once when either context is present (OR logic — no double-counting).
    if (hasExternalContext) {
      confidence += 0.07;
    }

    // Delegation prompt keyword matching (reduced weight)
    if (childBot.delegation_prompt) {
      const normalizedPrompt = normalizeText(childBot.delegation_prompt);
      const normalizedMessage = normalizeText(userMessage);
      const keywords = normalizedPrompt.split(/[，,、\s]+/).filter(w => w.length > 1);
      const matchCount = keywords.filter(kw => normalizedMessage.includes(kw)).length;
      if (matchCount > 0) {
        confidence += Math.min(matchCount * 0.03, 0.1);
      }
    }

    // Response quality evaluation
    // 1. Very short responses (< 20 chars) may be ineffective
    if (responseContent.length < 20) {
      confidence -= 0.1;
    }

    // 2. Degraded/template response indicator
    if (responseContent.includes('降级为模板回复') || responseContent.includes('LLM调用失败')) {
      confidence -= 0.2;
    }

    // 3. Contains concrete operational results (order numbers, refund IDs, etc.)
    const hasConcreteResult = /[A-Z]{2}-\d{4,}|RF\d{6,}|运单号|退款申请编号/.test(responseContent);
    if (hasConcreteResult) {
      confidence += 0.15;
    }

    // 4. Contains hedging/uncertainty language
    const uncertaintyPatterns = /可能|大概|或许|不太确定|建议您|不确定|估计/g;
    const uncertaintyCount = (responseContent.match(uncertaintyPatterns) || []).length;
    if (uncertaintyCount >= 2) {
      confidence -= 0.05;
    }

    // 5. Response addresses the user's question (basic keyword overlap)
    const userKeywords = userMessage
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 2);
    const overlapCount = userKeywords.filter(kw => responseContent.includes(kw)).length;
    if (overlapCount > 0 && userKeywords.length > 0) {
      confidence += Math.min(overlapCount / userKeywords.length * 0.1, 0.1);
    }

    return Math.min(Math.max(confidence, 0.1), 0.95);
  }

  /**
   * Handle collaboration between sub-agents
   * If a sub-agent's collaboration_config includes other sub-agents,
   * and the task might benefit from their input, send collaboration requests
   */
  private async handleCollaboration(
    conversationId: string,
    delegationId: string,
    childBot: BotConfigRow,
    inputMessage: string,
    _responseContent: string,
  ): Promise<AgentCollaborationRow[]> {
    const collaborations: AgentCollaborationRow[] = [];

    if (!childBot.collaboration_config) return collaborations;

    const config = childBot.collaboration_config as {
      can_collaborate_with?: string[];
      communication_mode?: string;
    };

    if (!config.can_collaborate_with || config.can_collaborate_with.length === 0) {
      return collaborations;
    }

    // Batch-fetch all collaboration targets in one query (P2-2)
    const targetBots = await this.botConfigRepo.findByIds(config.can_collaborate_with);
    const activeMap = new Map(targetBots.filter(b => b.status === 'active').map(b => [b.id, b]));

    // Create collaboration requests only for active targets
    for (const targetBotId of config.can_collaborate_with) {
      if (!activeMap.has(targetBotId)) continue;

      // Create collaboration request
      const collabInput: CreateCollaborationInput = {
        conversation_id: conversationId,
        delegation_id: delegationId,
        sender_bot_id: childBot.id,
        receiver_bot_id: targetBotId,
        message_type: 'notify',
        content: `「${childBot.name}」正在处理客户问题"${inputMessage}"，如需协助请回复`,
        context: { input_message: inputMessage, sender_name: childBot.name },
      };

      const collaboration = await this.subAgentRepo.createCollaboration(collabInput);
      collaborations.push(collaboration);
    }

    return collaborations;
  }

  /**
   * Send a collaboration message between sub-agents
   */
  async sendCollaboration(input: CollaborationRequest & { conversation_id: string; delegation_id?: string }): Promise<{ collaboration: AgentCollaborationRow }> {
    try {
      const collaboration = await this.subAgentRepo.createCollaboration({
        conversation_id: input.conversation_id,
        delegation_id: input.delegation_id ?? null,
        sender_bot_id: input.senderBotId,
        receiver_bot_id: input.receiverBotId,
        message_type: input.messageType,
        content: input.content,
        context: input.context ?? null,
      });

      return { collaboration };
    } catch (error) {
      throw toServiceError(error, '发送协作消息失败', 'COLLABORATION_ERROR');
    }
  }

  /**
   * Get delegation history for a conversation
   */
  async getDelegationHistory(conversationId: string): Promise<{
    delegations: AgentDelegationRow[];
    collaborations: AgentCollaborationRow[];
  }> {
    try {
      const [delegations, collaborations] = await Promise.all([
        this.subAgentRepo.listDelegations(conversationId),
        this.subAgentRepo.listCollaborations(conversationId),
      ]);

      return { delegations, collaborations };
    } catch (error) {
      throw toServiceError(error, '获取委派历史失败', 'DB_ERROR');
    }
  }

  /**
   * Get bot tree (parent + all sub-agents) for visualization
   */
  async getBotTree(parentBotId: string): Promise<{
    parent: BotConfigRow;
    children: BotConfigRow[];
  }> {
    try {
      const parent = await this.botConfigRepo.findById(parentBotId);
      if (!parent) {
        throw new ServiceError('Bot不存在', { status: 404, code: 'NOT_FOUND' });
      }

      const children = await this.botConfigRepo.listSubAgents(parentBotId);
      return { parent, children };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '获取Bot树失败', 'DB_ERROR');
    }
  }

  /**
   * Get all main bots with their sub-agent counts.
   * Uses single-query aggregation to avoid N+1 (P2-1).
   */
  async listMainBotsWithSubAgents(): Promise<Array<BotConfigRow & { sub_agent_count: number }>> {
    try {
      return await this.botConfigRepo.listMainBotsWithCounts();
    } catch (error) {
      throw toServiceError(error, '获取主Bot列表失败', 'DB_ERROR');
    }
  }
}
