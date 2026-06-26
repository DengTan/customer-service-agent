import { Config, KnowledgeClient, KnowledgeDocument, DataSourceType } from 'coze-coding-dev-sdk';
import {
  KnowledgeLearningRepository,
  type KnowledgeLearningFilters,
  type KnowledgeLearningItem,
  type MessageForScan,
} from '@/server/repositories/knowledge-learning-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export interface KnowledgeLearningListResult {
  items: KnowledgeLearningItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    pendingCount: number;
    approvedWeekCount: number;
    rejectedWeekCount: number;
    coverage: number;
  };
}

export interface ScanResult {
  scanned: number;
  extracted: number;
  message: string;
}

export interface ApproveResult {
  approved: number;
  total: number;
  errors?: string[];
}

export interface RejectResult {
  rejected: number;
}

export class KnowledgeLearningService {
  constructor(private readonly repo = new KnowledgeLearningRepository()) {}

  async listItems(filters: KnowledgeLearningFilters): Promise<KnowledgeLearningListResult> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    // Run both queries in parallel, let repositories handle their own errors
    const [itemsResult, stats] = await Promise.all([
      this.repo.list(filters).catch((err) => {
        console.error('[KnowledgeLearningService] list failed:', err);
        return { items: [], total: 0 };
      }),
      this.repo.getStats().catch((err) => {
        console.error('[KnowledgeLearningService] getStats failed:', err);
        return { pendingCount: 0, approvedWeekCount: 0, rejectedWeekCount: 0, coverage: 0 };
      }),
    ]);

    return {
      items: itemsResult.items,
      total: itemsResult.total,
      page,
      pageSize,
      stats,
    };
  }

  async scanConversations(): Promise<ScanResult> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const conversations = await this.repo.findConversationsForScan(sevenDaysAgo);

      if (!conversations || conversations.length === 0) {
        return { scanned: 0, extracted: 0, message: '未找到可扫描的对话' };
      }

      // Batch fetch all messages for all conversations (fixes N+1 query)
      const conversationIds = conversations.map((c) => c.id);
      const allMessages = await this.repo.findMessagesByConversations(conversationIds);

      // Build map of conversation_id -> messages
      const messagesByConversation = new Map<string, MessageForScan[]>();
      for (const conv of conversations) {
        messagesByConversation.set(conv.id, []);
      }
      for (const msg of allMessages) {
        const list = messagesByConversation.get(msg.conversation_id);
        if (list) {
          list.push(msg);
        }
      }

      // Batch fetch existing learning items to avoid N+1 on findRecentByConversation
      const existingItems = await this.repo.findRecentByConversations(conversationIds, []);

      let extracted = 0;

      for (const conv of conversations) {
        const messages = messagesByConversation.get(conv.id) || [];

        if (messages.length < 3) continue;

        for (let i = 0; i < messages.length - 2; i++) {
          const msg1 = messages[i];
          const msg2 = messages[i + 1];
          const msg3 = messages[i + 2];

          if (msg1.role !== 'user' || msg2.role !== 'assistant' || msg3.role !== 'user') continue;

          const confidence = msg2.confidence || 0;
          if (confidence > 0.85) continue;

          // Check existing items using batch result (fixes N+1)
          const existingQuestions = existingItems.get(conv.id) || new Set();
          if (existingQuestions.has(msg1.content)) continue;

          const contextMessages = messages.slice(Math.max(0, i - 1), Math.min(messages.length, i + 4));
          const sourceContext = contextMessages
            .map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '客服' : '系统'}: ${m.content}`)
            .join('\n');

          const category = guessCategory(msg1.content);

          await this.repo.insert({
            question: msg1.content,
            answer: msg2.content,
            confidence,
            conversation_id: conv.id,
            conversation_title: conv.title,
            source_context: sourceContext,
            category,
            status: 'pending',
          });

          extracted++;
        }
      }

      return {
        scanned: conversations.length,
        extracted,
        message: `扫描了 ${conversations.length} 个对话，提取了 ${extracted} 条候选知识`,
      };
    } catch (error) {
      throw toServiceError(error, '扫描对话失败');
    }
  }

  async approveItems(
    ids: string[],
    overrides?: { question?: string | null; answer?: string | null; category?: string | null },
  ): Promise<ApproveResult> {
    if (!ids || ids.length === 0) {
      throw new ServiceError('请提供要操作的条目ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const items = await this.repo.findByIds(ids);

      if (!items || items.length === 0) {
        throw new ServiceError('未找到指定条目', { status: 404, code: 'NOT_FOUND' });
      }

      const approvedIds: string[] = [];
      const errors: string[] = [];

      for (const item of items) {
        try {
          const finalQuestion = overrides?.question || item.question;
          const finalAnswer = overrides?.answer || item.answer;
          const finalCategory = (overrides?.category ?? item.category) ?? undefined;
          const finalCategoryForRepo: string | null = finalCategory ?? null;

          const knowledgeConfig = new Config();
          const knowledgeClient = new KnowledgeClient(knowledgeConfig);

          const qaContent = `问题：${finalQuestion}\n\n答案：${finalAnswer}`;
          const documents: KnowledgeDocument[] = [
            { source: DataSourceType.TEXT, raw_data: qaContent },
          ];

          const result = await knowledgeClient.addDocuments(documents, 'coze_doc_knowledge', {
            separator: '\n\n',
            max_tokens: 2000,
          });

          if (result.code !== 0) {
            errors.push(`知识入库失败（${item.question.slice(0, 20)}...）: ${result.msg}`);
            continue;
          }

          const docIds = result.doc_ids || [];
          const itemTitle =
            finalQuestion.length > 50 ? finalQuestion.slice(0, 50) + '...' : finalQuestion;

          const knowledgeItem = await this.repo.createKnowledgeItem({
            title: itemTitle,
            name: itemTitle,
            type: 'text',
            content: qaContent.slice(0, 500),
            doc_ids: docIds,
            category: finalCategoryForRepo,
            status: 'active',
            chunk_count: docIds.length,
          });

          await this.repo.updateItem(item.id, {
            status: 'approved',
            reviewed_at: new Date().toISOString(),
            knowledge_item_id: knowledgeItem.id,
            question: finalQuestion,
            answer: finalAnswer,
            category: finalCategoryForRepo,
            updated_at: new Date().toISOString(),
          });

          approvedIds.push(item.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : '未知错误';
          errors.push(`处理失败（${item.question.slice(0, 20)}...）: ${msg}`);
        }
      }

      return {
        approved: approvedIds.length,
        total: ids.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      throw toServiceError(error, '批准候选QA失败');
    }
  }

  async rejectItems(ids: string[]): Promise<RejectResult> {
    if (!ids || ids.length === 0) {
      throw new ServiceError('请提供要操作的条目ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.repo.updateBatch(ids, {
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return { rejected: ids.length };
    } catch (error) {
      throw toServiceError(error, '拒绝操作失败');
    }
  }

  async updateItem(
    id: string,
    updates: { question?: string | null; answer?: string | null; category?: string | null },
  ): Promise<void> {
    if (!id) {
      throw new ServiceError('请提供条目ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const updateData: Record<string, string> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.question) updateData.question = updates.question;
      if (updates.answer) updateData.answer = updates.answer;
      if (updates.category) updateData.category = updates.category;

      await this.repo.update(id, updateData);
    } catch (error) {
      throw toServiceError(error, '更新候选QA失败');
    }
  }
}

function guessCategory(content: string): string {
  const lower = content.toLowerCase();
  if (/退款|退货|换货|退换|售后/.test(lower)) return '售后相关';
  if (/物流|快递|发货|配送|到货|运输/.test(lower)) return '物流相关';
  if (/支付|付款|扣款|银行卡|微信支付|支付宝/.test(lower)) return '支付相关';
  if (/尺码|大小|尺寸|码数|合身/.test(lower)) return '产品相关';
  if (/优惠|折扣|满减|红包|券|活动/.test(lower)) return '优惠相关';
  if (/发票|开票|报销/.test(lower)) return '财务相关';
  if (/会员|积分|等级|vip/.test(lower)) return '会员相关';
  return '产品相关';
}
