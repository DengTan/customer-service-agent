import { LLMClientAdapter } from '@/server/services/llm-client-adapter';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

const COZE_BASE_URL = process.env.COZE_BASE_URL || 'https://api.coze.cn';
const COZE_API_KEY = process.env.COZE_API_KEY || '';

export class SummaryService {
  private readonly conversations = new ConversationRepository();

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
      // Verify conversation access before generating summary
      await this.verifyConversationAccess(conversationId);

      // Fetch existing summary
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
        baseUrl: COZE_BASE_URL,
        apiKey: COZE_API_KEY,
        customHeaders,
      });

      const summaryMessages: Array<{ role: 'system' | 'user'; content: string }> = [
        { role: 'user', content: summaryPrompt },
      ];

      let newSummary = '';
      const summaryStream = adapter.stream(summaryMessages, {
        model: 'doubao-seed-2-0-lite-260215',
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
    } catch {
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
