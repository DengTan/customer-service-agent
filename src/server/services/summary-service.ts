import { LLMClientAdapter } from '@/server/services/llm-client-adapter';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { LlmProviderService } from '@/server/services/llm-provider-service';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class SummaryService {
  private readonly conversations = new ConversationRepository();
  private readonly llmProviderService = new LlmProviderService();

  /**
   * Generate an incremental conversation summary after each AI reply.
   * Reads existing summary from the conversation row, appends the new exchange,
   * and asks LLM to produce a concise updated summary.
   */
  async generateIncrementalSummary(
    conversationId: string,
    userMessage: string,
    assistantReply: string,
    customHeaders: Record<string, string> = {},
  ): Promise<void> {
    try {
      await this.verifyConversationAccess(conversationId);

      const provider = await this.llmProviderService.getDefaultProvider();
      if (!provider) {
        throw new ServiceError(
          'LLM 提供商未配置，无法生成对话摘要。请在 设置 → AI 模型 中配置 LLM 提供商。',
          { code: 'LLM_PROVIDER_NOT_CONFIGURED' },
        );
      }
      if (!provider.api_key) {
        throw new ServiceError(
          `LLM 提供商 "${provider.display_name}" 缺少 API Key，无法生成对话摘要。请在 设置 → AI 模型 中补全 API Key。`,
          { code: 'LLM_PROVIDER_MISSING_API_KEY' },
        );
      }

      const providerWithKey = await this.llmProviderService.getProviderWithDecryptedKey(provider.id);
      const apiKey = providerWithKey?.api_key || provider.api_key || '';

      const existingSummary = await this.conversations.findSummary(conversationId);

      const summaryPrompt = `你是一个对话摘要助手。请根据以下信息生成一段简洁的中文对话摘要。

要求：
- 摘要应该让人工客服能快速了解对话进展和当前状态
- 包含：用户的核心问题、AI已提供的解决方案/信息、尚未解决的事项
- 控制在2-3句话以内，不超过100字
- 只输出摘要内容，不要有任何前缀或解释

${existingSummary ? `【之前的对话摘要】\n${existingSummary}\n` : ''}【本轮对话】
用户: ${userMessage}
客服: ${assistantReply}`;

      const adapter = new LLMClientAdapter({
        baseUrl: provider.base_url,
        apiKey,
        customHeaders,
      });

      const summaryMessages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'user', content: summaryPrompt },
      ];

      let newSummary = '';
      const summaryStream = adapter.stream(summaryMessages, {
        model: provider.models?.[0] || '',
        temperature: 0.3,
      });

      for await (const chunk of summaryStream) {
        if (chunk.content) {
          newSummary += chunk.content.toString();
        }
      }

      if (newSummary.trim()) {
        await this.conversations.update(conversationId, {
          summary: newSummary.trim(),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Provider 配置错误必须冒泡给调用方（写入 alerts），其它错误（如 DB 写入失败）静默吞掉
      if (error instanceof ServiceError && (error.code === 'LLM_PROVIDER_NOT_CONFIGURED' || error.code === 'LLM_PROVIDER_MISSING_API_KEY')) {
        throw error;
      }
      // Silently fail - summary is a nice-to-have, not critical
    }
  }

  /**
   * Verify that the conversation exists and is accessible.
   * Throws ServiceError if conversation is not found.
   */
  private async verifyConversationAccess(conversationId: string): Promise<void> {
    try {
      const conversation = await this.conversations.findById(conversationId);
      if (!conversation) {
        throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, 'Failed to verify conversation access', 'DB_QUERY_ERROR');
    }
  }
}
