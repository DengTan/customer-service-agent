import { KnowledgeFeedbackRepository, type KnowledgeFeedbackInput, type KnowledgeQualityStat } from '@/server/repositories/knowledge-feedback-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

export class KnowledgeFeedbackService {
  constructor(private readonly feedback = new KnowledgeFeedbackRepository()) {}

  async recordFeedback(input: KnowledgeFeedbackInput): Promise<{ id: string }> {
    if (!input.message_id) {
      throw new ServiceError('消息ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (input.feedback_type !== 'adopted' && input.feedback_type !== 'rejected') {
      throw new ServiceError('feedback_type 必须是 adopted 或 rejected', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const record = await this.feedback.create(input);
      // 原子更新知识条目自身计数（fire-and-forget 不阻塞主流程）
      if (input.knowledge_item_id) {
        this.feedback.incrementAdoptionCounter(input.knowledge_item_id, input.feedback_type).catch((err) => {
          logger.error('[KnowledgeFeedbackService] Failed to increment adoption counter', { error: err, knowledgeItemId: input.knowledge_item_id });
        });
      }
      return { id: record.id };
    } catch (error) {
      throw toServiceError(error, '记录反馈失败', 'DB_ERROR');
    }
  }

  async listByMessage(messageId: string): Promise<{ feedbacks: unknown[] }> {
    if (!messageId) {
      throw new ServiceError('消息ID不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const feedbacks = await this.feedback.listByMessage(messageId);
      return { feedbacks };
    } catch (error) {
      throw toServiceError(error, '获取反馈记录失败', 'DB_QUERY_ERROR');
    }
  }

  async getQualityStats(filters: { item_id?: string; minHit?: number; limit?: number } = {}): Promise<{ stats: KnowledgeQualityStat[] }> {
    try {
      const stats = await this.feedback.getQualityStats(filters);
      return { stats };
    } catch (error) {
      throw toServiceError(error, '获取质量统计失败', 'DB_QUERY_ERROR');
    }
  }
}
