import { BotConfigRepository, type BotConfigRow } from '@/server/repositories/bot-config-repository';
import {
  SubAgentRepository,
  type AgentDelegationRow,
  type AgentCollaborationRow,
  type CreateDelegationInput,
  type CreateCollaborationInput,
} from '@/server/repositories/sub-agent-repository';

// Local error class for service-level errors
class ServiceError extends Error {
  public readonly status: number;
  public readonly code: string;
  constructor(message: string, opts: { status: number; code: string }) {
    super(message);
    this.status = opts.status;
    this.code = opts.code;
  }
}

function toServiceError(error: unknown, fallbackMessage: string, fallbackCode: string): ServiceError {
  if (error instanceof ServiceError) return error;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new ServiceError(message, { status: 500, code: fallbackCode });
}

// Normalize text to prevent zero-width character bypass attacks
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFC')
    .replace(/[\u200B-\u200F\uFEFF\u00AD]/g, '');
}

// Intent categories for sub-agent routing
const INTENT_CATEGORIES: Record<string, string[]> = {
  order_query: ['订单', '查询订单', '订单状态', '到哪了', '物流', '快递', '发货', '收货', '订单号', '修改地址', '取消订单'],
  refund_request: ['退款', '退钱', '退款进度', '退款状态', '退款查询'],
  after_sales: ['换货', '退货', '维权', '投诉', '质量问题', '破损', '瑕疵', '假货', '维修', '售后'],
};

export interface DelegationResult {
  delegation: AgentDelegationRow;
  childBot: BotConfigRow;
  responseContent: string;
  confidence: number;
  collaborations?: AgentCollaborationRow[];
}

export interface CollaborationRequest {
  senderBotId: string;
  receiverBotId: string;
  messageType: 'request' | 'response' | 'notify';
  content: string;
  context?: Record<string, unknown>;
}

export class SubAgentService {
  private readonly botConfigRepo = new BotConfigRepository();
  private readonly subAgentRepo = new SubAgentRepository();

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
      // Verify parent bot exists
      const parentBot = await this.botConfigRepo.findById(input.parent_bot_id);
      if (!parentBot) {
        throw new ServiceError('父Bot不存在', { status: 404, code: 'NOT_FOUND' });
      }
      if (parentBot.is_sub_agent) {
        throw new ServiceError('子Agent不能作为父Bot', { status: 400, code: 'VALIDATION_ERROR' });
      }

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
      const responseContent = await this.generateSubAgentResponse(childBot, input.input_message);

      // Calculate confidence based on sub-agent's configuration and actual response quality
      const confidence = this.calculateSubAgentConfidence(childBot, input.input_message, responseContent);

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
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '委派任务失败', 'DELEGATION_ERROR');
    }
  }

  /**
   * Generate a response from a sub-agent using the LLM
   * Uses the coze-coding-dev-sdk to call the LLM with the sub-agent's system_prompt
   */
  private async generateSubAgentResponse(childBot: BotConfigRow, userMessage: string): Promise<string> {
    // Validate required environment variable
    const botId = process.env.COZE_BOT_ID;
    if (!botId) {
      throw new Error('Sub-agent LLM 调用失败: COZE_BOT_ID 环境变量未配置');
    }

    try {
      const { LLMClient, Config } = await import('coze-coding-dev-sdk');
      const config = new Config();
      const client = new LLMClient(config);

      const systemPrompt = childBot.system_prompt || '你是一个专业的客服助手。';
      const toolInfo = Array.isArray(childBot.tools) && childBot.tools.length > 0
        ? `\n\n你可使用的工具：${childBot.tools.map((t: unknown) => String(t)).join('、')}`
        : '';

      const messages = [
        { role: 'system' as const, content: systemPrompt + toolInfo },
        { role: 'user' as const, content: userMessage },
      ];

      // Use the LLMClient.stream API (same as llm-streaming-service.ts)
      const stream = client.stream(
        messages as Parameters<typeof client.stream>[0],
        { model: botId, temperature: 0.7 },
      );

      let responseContent = '';
      for await (const chunk of stream) {
        if (chunk.content) {
          responseContent += chunk.content.toString();
        }
      }

      if (!responseContent.trim()) {
        return `[子Agent「${childBot.name}」处理中]\n${childBot.description}\n\n抱歉，专家正在处理您的问题，请稍候。`;
      }

      return responseContent;
    } catch (error) {
      console.error('[SubAgentService] Failed to generate sub-agent response via LLM:', error);
      const toolList = Array.isArray(childBot.tools) ? childBot.tools.map((t: unknown) => {
        const toolName = String(t);
        const toolLabels: Record<string, string> = {
          order_query: '查询订单',
          logistics_query: '查询物流',
          refund_action: '申请退款',
        };
        return toolLabels[toolName] || toolName;
      }).join('、') : '无';

      return `[子Agent「${childBot.name}」处理]\n${childBot.description}\n\n可用工具：${toolList}\n\n⚠️ LLM调用失败，已降级为模板回复。`;
    }
  }

  /**
   * Calculate the confidence score for a sub-agent's response.
   * Evaluates both static configuration (tools, knowledge) and actual response quality.
   */
  private calculateSubAgentConfidence(childBot: BotConfigRow, userMessage: string, responseContent: string): number {
    let confidence = 0.5; // Base confidence

    // Configuration signals (reduced weight from original — these are just potential, not proof)
    if (Array.isArray(childBot.tools) && childBot.tools.length > 0) {
      confidence += 0.05;
    }
    if (Array.isArray(childBot.knowledge_ids) && childBot.knowledge_ids.length > 0) {
      confidence += 0.05;
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

    // Check if any collaboration targets have relevant info
    for (const targetBotId of config.can_collaborate_with) {
      const targetBot = await this.botConfigRepo.findById(targetBotId);
      if (!targetBot || targetBot.status !== 'active') continue;

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
   * Get all main bots with their sub-agent counts
   */
  async listMainBotsWithSubAgents(): Promise<Array<BotConfigRow & { sub_agent_count: number }>> {
    try {
      const mainBots = await this.botConfigRepo.listMainBots();
      const results = await Promise.all(
        mainBots.map(async (bot) => {
          const subAgents = await this.botConfigRepo.listSubAgents(bot.id);
          return { ...bot, sub_agent_count: subAgents.length };
        }),
      );
      return results;
    } catch (error) {
      throw toServiceError(error, '获取主Bot列表失败', 'DB_ERROR');
    }
  }
}
