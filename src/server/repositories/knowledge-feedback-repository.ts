import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { logger } from '@/lib/logger';

export interface KnowledgeFeedbackInput {
  message_id: string;
  conversation_id?: string | null;
  knowledge_item_id?: string | null;
  /** P2: stable chunk identity — prefer as audit key over knowledge_item_id alone */
  chunk_id?: string | null;
  chunk_index?: number;
  content_hash?: string | null;
  knowledge_name?: string | null;
  knowledge_score?: number | null;
  feedback_type: 'adopted' | 'rejected';
  reason?: string | null;
  comment?: string | null;
}

export interface KnowledgeFeedbackItem {
  id: string;
  message_id: string;
  conversation_id: string | null;
  knowledge_item_id: string | null;
  // P2: chunk-level citation identity
  chunk_id: string | null;
  chunk_index: number | null;
  content_hash: string | null;
  knowledge_name: string | null;
  knowledge_score: number | null;
  feedback_type: 'adopted' | 'rejected';
  reason: string | null;
  comment: string | null;
  created_at: string;
}

export interface KnowledgeQualityStat {
  knowledge_item_id: string;
  name: string;
  category: string | null;
  parent_category: string | null;
  hit_count: number;
  adopted_count: number;
  rejected_count: number;
  feedback_total: number;
  adopt_rate: number | null; // 0-1，null=无反馈
}

// Demo mode in-memory store
const demoFeedback: KnowledgeFeedbackItem[] = [];

export class KnowledgeFeedbackRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(input: KnowledgeFeedbackInput): Promise<KnowledgeFeedbackItem> {
    if (isDemoMode()) {
      const record: KnowledgeFeedbackItem = {
        id: `demo-fb-${Date.now()}`,
        message_id: input.message_id,
        conversation_id: input.conversation_id ?? null,
        knowledge_item_id: input.knowledge_item_id ?? null,
        chunk_id: input.chunk_id ?? null,
        chunk_index: input.chunk_index ?? null,
        content_hash: input.content_hash ?? null,
        knowledge_name: input.knowledge_name ?? null,
        knowledge_score: input.knowledge_score ?? null,
        feedback_type: input.feedback_type,
        reason: input.reason ?? null,
        comment: input.comment ?? null,
        created_at: new Date().toISOString(),
      };
      demoFeedback.push(record);
      return record;
    }

    const { data, error } = await this.client
      .from('knowledge_feedback')
      .insert({
        message_id: input.message_id,
        conversation_id: input.conversation_id ?? null,
        knowledge_item_id: input.knowledge_item_id ?? null,
        chunk_id: input.chunk_id ?? null,
        chunk_index: input.chunk_index ?? null,
        content_hash: input.content_hash ?? null,
        knowledge_name: input.knowledge_name ?? null,
        knowledge_score: input.knowledge_score ?? null,
        feedback_type: input.feedback_type,
        reason: input.reason ?? null,
        comment: input.comment ?? null,
      })
      .select('id, message_id, conversation_id, knowledge_item_id, chunk_id, chunk_index, content_hash, knowledge_name, knowledge_score, feedback_type, reason, comment, created_at')
      .single();

    if (error) {
      throw new RepositoryError('create knowledge feedback', error.message, error.code);
    }
    return data as KnowledgeFeedbackItem;
  }

  /**
   * 列出某条消息的所有反馈记录（前端切换/聚合时使用）
   */
  async listByMessage(messageId: string): Promise<KnowledgeFeedbackItem[]> {
    if (isDemoMode()) {
      return demoFeedback.filter(f => f.message_id === messageId);
    }
    const { data, error } = await this.client
      .from('knowledge_feedback')
      .select('id, message_id, conversation_id, knowledge_item_id, knowledge_name, knowledge_score, feedback_type, reason, comment, created_at')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new RepositoryError('list knowledge feedback by message', error.message, error.code);
    }
    return (data || []) as KnowledgeFeedbackItem[];
  }

  /**
   * 知识条目质量统计（按条目聚合采纳/拒绝次数 + 采纳率）
   * 用知识条目自身字段（adopted_count / rejected_count / hit_count）做轻量统计
   * 若需要按反馈明细聚合，可扩展此处为 JOIN knowledge_feedback
   */
  async getQualityStats(filters: { item_id?: string; minHit?: number; limit?: number } = {}): Promise<KnowledgeQualityStat[]> {
    if (isDemoMode()) {
      // Demo: 直接给三个示例
      return [
        { knowledge_item_id: 'demo-ki-1', name: '退换货政策', category: '售后', parent_category: null, hit_count: 12, adopted_count: 9, rejected_count: 1, feedback_total: 10, adopt_rate: 0.9 },
        { knowledge_item_id: 'demo-ki-2', name: '配送时效说明', category: '物流', parent_category: null, hit_count: 8, adopted_count: 5, rejected_count: 2, feedback_total: 7, adopt_rate: 0.71 },
        { knowledge_item_id: 'demo-ki-3', name: '支付方式说明', category: '支付', parent_category: null, hit_count: 5, adopted_count: 4, rejected_count: 0, feedback_total: 4, adopt_rate: 1.0 },
        { knowledge_item_id: 'demo-ki-4', name: '会员权益说明', category: '会员', parent_category: null, hit_count: 3, adopted_count: 1, rejected_count: 2, feedback_total: 3, adopt_rate: 0.33 },
      ];
    }

    let query = this.client
      .from('knowledge_items')
      .select('id, name, category, parent_category, hit_count, adopted_count, rejected_count, status, archived_at')
      .neq('status', 'deleted');

    if (filters.item_id) {
      query = query.eq('id', filters.item_id);
    } else {
      // 仅展示有命中或反馈的条目；minHit=0 时不附加条件
      const minHit = filters.minHit ?? 0;
      if (minHit > 0) {
        query = query.gt('hit_count', minHit - 1);
      }
    }

    const limit = filters.limit ?? 100;
    query = query.order('hit_count', { ascending: false }).limit(limit);

    const { data, error } = await query;
    if (error) {
      throw new RepositoryError('get knowledge quality stats', error.message, error.code);
    }

    return (data || []).map((row: Record<string, unknown>) => {
      const adopted = (row.adopted_count as number) || 0;
      const rejected = (row.rejected_count as number) || 0;
      const total = adopted + rejected;
      return {
        knowledge_item_id: row.id as string,
        name: (row.name as string) || '未命名',
        category: (row.category as string) || null,
        parent_category: (row.parent_category as string) || null,
        hit_count: (row.hit_count as number) || 0,
        adopted_count: adopted,
        rejected_count: rejected,
        feedback_total: total,
        adopt_rate: total > 0 ? adopted / total : null,
      };
    });
  }

  /**
   * 原子更新 knowledge_items 上的采纳/拒绝计数（read-then-write，Supabase JS 不支持原子自增）
   * 仅当 knowledge_item_id 存在时执行
   */
  async incrementAdoptionCounter(itemId: string, type: 'adopted' | 'rejected'): Promise<void> {
    if (isDemoMode() || !itemId) return;
    try {
      const field = type === 'adopted' ? 'adopted_count' : 'rejected_count';
      const { data: item } = await this.client
        .from('knowledge_items')
        .select(field)
        .eq('id', itemId)
        .maybeSingle();
      const current = ((item as Record<string, number> | null)?.[field]) ?? 0;
      await this.client
        .from('knowledge_items')
        .update({ [field]: current + 1, last_hit_at: new Date().toISOString() })
        .eq('id', itemId);
    } catch (error) {
      logger.error('[KnowledgeFeedbackRepository] Failed to increment counter', { error });
    }
  }
}
