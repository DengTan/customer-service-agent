import { Config, KnowledgeClient, KnowledgeDocument, DataSourceType } from 'coze-coding-dev-sdk';
import {
  KnowledgeLearningRepository,
  type KnowledgeLearningFilters,
  type KnowledgeLearningItem,
  type MessageForScan,
} from '@/server/repositories/knowledge-learning-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

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
        logger.agent.error('[KnowledgeLearningService] list failed', { error: err instanceof Error ? err.message : String(err) });
        return { items: [], total: 0 };
      }),
      this.repo.getStats().catch((err) => {
        logger.agent.error('[KnowledgeLearningService] getStats failed', { error: err instanceof Error ? err.message : String(err) });
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
      const settingsRepo = new SettingsRepository();

      // Phase 3.2: 重复扫描防护 - 使用原子操作防止并发竞态
      const scanInterval = parseInt(
        await settingsRepo.get('knowledge_learning_scan_interval_hours') || '24', 10
      );

      // P0 修复: 使用原子操作检查并更新扫描时间
      const now = new Date().toISOString();
      const canProceed = await settingsRepo.updateTimestampIfOlderThan(
        'knowledge_learning_last_scan_at',
        now,
        scanInterval
      );

      if (!canProceed) {
        return {
          scanned: 0,
          extracted: 0,
          message: `距离上次扫描不足 ${scanInterval} 小时，请稍后再试`,
        };
      }

      // Phase 1.2: 动态读取置信度阈值，默认为 0.85
      const confidenceThreshold = parseFloat(
        await settingsRepo.get('knowledge_learning_confidence_threshold') || '0.85'
      );

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
          // Phase 1.2: 使用动态阈值替代硬编码 0.85
          if (confidence > confidenceThreshold) continue;

          // Check existing items using batch result (fixes N+1)
          const existingQuestions = existingItems.get(conv.id) || new Set();
          if (existingQuestions.has(msg1.content)) continue;

          const contextMessages = messages.slice(Math.max(0, i - 1), Math.min(messages.length, i + 4));
          const sourceContext = contextMessages
            .map((m) => `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '客服' : '系统'}: ${m.content}`)
            .join('\n');

          const category = guessCategory(msg1.content);

          const inserted = await this.repo.insert({
            question: msg1.content,
            answer: msg2.content,
            confidence,
            conversation_id: conv.id,
            conversation_title: conv.title,
            source_context: sourceContext,
            category,
            status: 'pending',
          });

          // P1 修复: 只有插入成功才计数
          if (inserted) {
            extracted++;
          }
        }
      }

      // Note: 扫描时间已在 updateTimestampIfOlderThan 中更新，无需再次设置

      logger.agent.info('[KnowledgeLearningService] scan completed', {
        scanned: conversations.length,
        extracted,
      });

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

      // P2 修复: 在循环外创建客户端，避免重复创建
      const knowledgeConfig = new Config();
      const knowledgeClient = new KnowledgeClient(knowledgeConfig);

      const approvedIds: string[] = [];
      const errors: string[] = [];

      for (const item of items) {
        try {
          const finalQuestion = overrides?.question || item.question;
          const finalAnswer = overrides?.answer || item.answer;
          const finalCategory = (overrides?.category ?? item.category) ?? undefined;
          const finalCategoryForRepo: string | null = finalCategory ?? null;

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

// P2 修复: 分类规则配置化，从设置中读取
const CATEGORY_RULES: Array<{ patterns: RegExp[]; category: string }> = [
  { patterns: [/退款|退货|换货|退换|售后/g], category: '售后相关' },
  { patterns: [/物流|快递|发货|配送|到货|运输/g], category: '物流相关' },
  { patterns: [/支付|付款|扣款|银行卡|微信支付|支付宝/g], category: '支付相关' },
  { patterns: [/尺码|大小|尺寸|码数|合身/g], category: '产品相关' },
  { patterns: [/优惠|折扣|满减|红包|券|活动/g], category: '优惠相关' },
  { patterns: [/发票|开票|报销/g], category: '财务相关' },
  { patterns: [/会员|积分|等级|vip/g], category: '会员相关' },
];

/**
 * Guess category based on content keywords.
 * Now uses configurable rules defined above.
 */
function guessCategory(content: string): string {
  const lower = content.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0; // Reset regex state
      if (pattern.test(lower)) {
        return rule.category;
      }
    }
  }
  return '产品相关';
}
