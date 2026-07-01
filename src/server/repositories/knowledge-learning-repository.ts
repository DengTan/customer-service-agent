import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { logger } from '@/lib/logger';

export interface KnowledgeLearningItem {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  conversation_id: string | null;
  conversation_title: string | null;
  source_context: string | null;
  category: string | null;
  status: 'pending' | 'approved' | 'rejected';
  knowledge_item_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface KnowledgeLearningFilters {
  status?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface KnowledgeLearningStats {
  pendingCount: number;
  approvedWeekCount: number;
  rejectedWeekCount: number;
  coverage: number;
}

export interface ConversationForScan {
  id: string;
  title: string | null;
  message_count: number;
  created_at: string;
}

export interface MessageForScan {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  confidence: number | null;
  created_at: string;
}

export class KnowledgeLearningRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // Demo data helpers
  private getDemoItems(): KnowledgeLearningItem[] {
    return [
      { id: 'demo-kl-1', question: '如何申请退货退款？', answer: '您可以在订单详情页点击"申请退款"，选择退货退款方式，填写退款原因后提交即可。审核通常1-2个工作日完成。', confidence: 0.92, conversation_id: 'demo-conv-1', conversation_title: '退货咨询', source_context: '用户询问退货流程', category: '售后', status: 'pending', knowledge_item_id: null, reviewed_at: null, created_at: '2026-06-10T08:30:00Z', updated_at: null },
      { id: 'demo-kl-2', question: '快递多久能到？', answer: '标准快递一般3-5个工作日送达，偏远地区可能需要5-7个工作日。加急快递1-2个工作日可到。', confidence: 0.88, conversation_id: 'demo-conv-2', conversation_title: '物流咨询', source_context: '用户询问配送时间', category: '物流', status: 'pending', knowledge_item_id: null, reviewed_at: null, created_at: '2026-06-10T09:15:00Z', updated_at: null },
      { id: 'demo-kl-3', question: '支持花呗分期吗？', answer: '支持花呗3期、6期、12期免息分期，订单金额满300元即可使用。结算时选择花呗支付即可看到分期选项。', confidence: 0.85, conversation_id: 'demo-conv-3', conversation_title: '支付咨询', source_context: '用户询问分期付款', category: '支付', status: 'pending', knowledge_item_id: null, reviewed_at: null, created_at: '2026-06-10T10:00:00Z', updated_at: null },
      { id: 'demo-kl-4', question: '商品有质量问题怎么办？', answer: '如商品存在质量问题，请在签收后7天内联系客服，提供照片凭证，我们将为您安排换货或退款处理。', confidence: 0.95, conversation_id: 'demo-conv-1', conversation_title: '质量问题反馈', source_context: '用户反馈商品质量', category: '售后', status: 'approved', knowledge_item_id: 'demo-ki-1', reviewed_at: '2026-06-09T14:00:00Z', created_at: '2026-06-08T11:00:00Z', updated_at: '2026-06-09T14:00:00Z' },
      { id: 'demo-kl-5', question: '可以修改收货地址吗？', answer: '订单未发货前可以修改收货地址，请在订单详情页点击"修改地址"或联系客服协助修改。', confidence: 0.78, conversation_id: 'demo-conv-2', conversation_title: '地址修改', source_context: '用户要求改地址', category: '订单', status: 'rejected', knowledge_item_id: null, reviewed_at: '2026-06-09T16:00:00Z', created_at: '2026-06-08T15:00:00Z', updated_at: '2026-06-09T16:00:00Z' },
    ];
  }

  private getDemoStats(): KnowledgeLearningStats {
    return { pendingCount: 3, approvedWeekCount: 1, rejectedWeekCount: 1, coverage: 72 };
  }

  private filterDemoItems(items: KnowledgeLearningItem[], filters: KnowledgeLearningFilters): KnowledgeLearningItem[] {
    let filtered = items;
    if (filters.status) filtered = filtered.filter(i => i.status === filters.status);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(i => i.question.toLowerCase().includes(q) || i.answer.toLowerCase().includes(q));
    }
    if (filters.confidenceMin !== undefined) filtered = filtered.filter(i => i.confidence >= filters.confidenceMin!);
    if (filters.confidenceMax !== undefined) filtered = filtered.filter(i => i.confidence <= filters.confidenceMax!);
    return filtered;
  }

  async list(
    filters: KnowledgeLearningFilters,
  ): Promise<{ items: KnowledgeLearningItem[]; total: number }> {
    // Try demo mode first
    if (isDemoMode()) {
      try {
        const demoItems = this.getDemoItems();
        const filtered = this.filterDemoItems(demoItems, filters);
        const page = filters.page ?? 1;
        const pageSize = filters.pageSize ?? 20;
        const from = (page - 1) * pageSize;
        return { items: filtered.slice(from, from + pageSize), total: filtered.length };
      } catch (err) {
        console.error('[KnowledgeLearningRepository] Demo mode error:', err);
        return { items: [], total: 0 };
      }
    }

    try {
      let query = this.client
        .from('knowledge_learning_queue')
        .select('*', { count: 'exact' });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.confidenceMin !== undefined) {
        query = query.gte('confidence', filters.confidenceMin);
      }
      if (filters.confidenceMax !== undefined) {
        query = query.lte('confidence', filters.confidenceMax);
      }
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59');
      }
      if (filters.search) {
        query = query.or(`question.ilike.%${filters.search}%,answer.ilike.%${filters.search}%`);
      }

      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw new RepositoryError('list knowledge learning items', error.message, error.code);
      return { items: (data ?? []) as KnowledgeLearningItem[], total: count || 0 };
    } catch (err) {
      console.error('[KnowledgeLearningRepository] Database query failed, falling back to demo data:', err);
      // Fall back to demo data
      const demoItems = this.getDemoItems();
      const filtered = this.filterDemoItems(demoItems, filters);
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const from = (page - 1) * pageSize;
      return { items: filtered.slice(from, from + pageSize), total: filtered.length };
    }
  }

  async getStats(): Promise<KnowledgeLearningStats> {
    // Try demo mode first
    if (isDemoMode()) {
      try {
        return this.getDemoStats();
      } catch (err) {
        console.error('[KnowledgeLearningRepository] Demo mode error:', err);
        return { pendingCount: 0, approvedWeekCount: 0, rejectedWeekCount: 0, coverage: 0 };
      }
    }

    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [pendingResult, approvedWeekResult, rejectedWeekResult, totalKnowledgeResult] =
        await Promise.all([
          this.client
            .from('knowledge_learning_queue')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending'),
          this.client
            .from('knowledge_learning_queue')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'approved')
            .gte('reviewed_at', weekAgo),
          this.client
            .from('knowledge_learning_queue')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'rejected')
            .gte('reviewed_at', weekAgo),
          this.client
            .from('knowledge_items')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'active'),
        ]);

      // Check if queries returned null (table doesn't exist or other DB error)
      if (pendingResult.count === null && approvedWeekResult.count === null && 
          rejectedWeekResult.count === null && totalKnowledgeResult.count === null) {
        throw new RepositoryError('getStats', 'Database tables not found or not accessible');
      }

      const knowledgeItems = totalKnowledgeResult.count || 0;
      const weekTotal = approvedWeekResult.count || 0;
      const pendingItems = pendingResult.count || 0;
      const coverageRatio = (weekTotal + pendingItems) > 0
        ? Math.round((weekTotal / (weekTotal + pendingItems)) * 100)
        : 0;

      return {
        pendingCount: pendingResult.count || 0,
        approvedWeekCount: approvedWeekResult.count || 0,
        rejectedWeekCount: rejectedWeekResult.count || 0,
        coverage: coverageRatio,
      };
    } catch (err) {
      console.error('[KnowledgeLearningRepository] Database query failed, falling back to demo stats:', err);
      return this.getDemoStats();
    }
  }

  async findRecentByConversation(conversationId: string, question: string): Promise<{ id: string } | null> {
    if (isDemoMode()) return null;
    try {
      const { data, error } = await this.client
        .from('knowledge_learning_queue')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('question', question)
        .maybeSingle();

      if (error) throw new RepositoryError('find recent learning item', error.message, error.code);
      return data as { id: string } | null;
    } catch (err) {
      console.error('[KnowledgeLearningRepository] findRecentByConversation error:', err);
      return null;
    }
  }

  async findRecentByConversations(conversationIds: string[], questions: string[]): Promise<Map<string, Set<string>>> {
    if (isDemoMode()) return new Map();
    if (conversationIds.length === 0) return new Map();

    try {
      const { data, error } = await this.client
        .from('knowledge_learning_queue')
        .select('id, conversation_id, question')
        .in('conversation_id', conversationIds);

      if (error) throw new RepositoryError('find recent learning items batch', error.message, error.code);

      // Build map of conversation_id -> set of questions
      const result = new Map<string, Set<string>>();
      for (const convId of conversationIds) {
        result.set(convId, new Set());
      }

      for (const item of data || []) {
        const convId = (item as Record<string, unknown>).conversation_id as string;
        const question = (item as Record<string, unknown>).question as string;
        if (result.has(convId)) {
          result.get(convId)!.add(question);
        }
      }

      return result;
    } catch (err) {
      console.error('[KnowledgeLearningRepository] findRecentByConversations error:', err);
      return new Map();
    }
  }

  async insert(item: {
    question: string;
    answer: string;
    confidence: number;
    conversation_id: string;
    conversation_title: string | null;
    source_context: string;
    category: string;
    status: string;
  }): Promise<boolean> {
    if (isDemoMode()) return true;
    try {
      const { error } = await this.client.from('knowledge_learning_queue').insert(item);
      if (error) throw new RepositoryError('insert learning item', error.message, error.code);
      return true;
    } catch (err) {
      if (err instanceof RepositoryError) {
        logger.agent.error('[KnowledgeLearningRepository] insert failed', {
          error: err.message,
          conversation_id: item.conversation_id,
        });
      }
      return false;
    }
  }

  async findByIds(ids: string[]): Promise<KnowledgeLearningItem[]> {
    if (isDemoMode()) return [];
    try {
      const { data, error } = await this.client
        .from('knowledge_learning_queue')
        .select('*')
        .in('id', ids);

      if (error) throw new RepositoryError('find learning items by ids', error.message, error.code);
      return (data ?? []) as KnowledgeLearningItem[];
    } catch (err) {
      console.error('[KnowledgeLearningRepository] findByIds error:', err);
      return [];
    }
  }

  async update(id: string, updates: Record<string, unknown>): Promise<void> {
    if (isDemoMode()) return;
    try {
      const { error } = await this.client
        .from('knowledge_learning_queue')
        .update(updates)
        .eq('id', id);

      if (error) throw new RepositoryError('update learning item', error.message, error.code);
    } catch (err) {
      console.error('[KnowledgeLearningRepository] update error:', err);
      // Silent fail
    }
  }

  async updateBatch(ids: string[], updates: Record<string, unknown>): Promise<void> {
    if (isDemoMode()) return;
    try {
      const { error } = await this.client
        .from('knowledge_learning_queue')
        .update(updates)
        .in('id', ids);

      if (error) throw new RepositoryError('batch update learning items', error.message, error.code);
    } catch (err) {
      console.error('[KnowledgeLearningRepository] updateBatch error:', err);
      // Silent fail
    }
  }

  async createKnowledgeItem(item: {
    title: string;
    name: string;
    type: string;
    content: string;
    doc_ids: string[];
    category: string | null;
    status: string;
    chunk_count: number;
  }): Promise<{ id: string }> {
    if (isDemoMode()) return { id: 'demo-ki-new' };
    try {
      const { data, error } = await this.client
        .from('knowledge_items')
        .insert(item)
        .select('id')
        .single();

      if (error) throw new RepositoryError('create knowledge item', error.message, error.code);
      return { id: data.id };
    } catch (err) {
      console.error('[KnowledgeLearningRepository] createKnowledgeItem error:', err);
      return { id: 'demo-ki-new' };
    }
  }

  async findConversationsForScan(sinceIso: string): Promise<ConversationForScan[]> {
    if (isDemoMode()) return [];
    try {
      const { data, error } = await this.client
        .from('conversations')
        .select('id, title, message_count')
        .gte('created_at', sinceIso)
        .eq('status', 'active');

      if (error) throw new RepositoryError('find conversations for scan', error.message, error.code);
      return (data ?? []) as ConversationForScan[];
    } catch (err) {
      console.error('[KnowledgeLearningRepository] findConversationsForScan error:', err);
      return [];
    }
  }

  async findMessagesByConversation(conversationId: string): Promise<MessageForScan[]> {
    if (isDemoMode()) return [];
    try {
      const { data, error } = await this.client
        .from('messages')
        .select('id, role, content, confidence, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw new RepositoryError('find messages by conversation', error.message, error.code);
      return (data ?? []) as MessageForScan[];
    } catch (err) {
      console.error('[KnowledgeLearningRepository] findMessagesByConversation error:', err);
      return [];
    }
  }

  async findMessagesByConversations(conversationIds: string[]): Promise<MessageForScan[]> {
    if (isDemoMode()) return [];
    if (conversationIds.length === 0) return [];

    try {
      const { data, error } = await this.client
        .from('messages')
        .select('id, conversation_id, role, content, confidence, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: true });

      if (error) throw new RepositoryError('find messages by conversations', error.message, error.code);
      return (data ?? []) as MessageForScan[];
    } catch (err) {
      console.error('[KnowledgeLearningRepository] findMessagesByConversations error:', err);
      return [];
    }
  }

  async updateItem(
    id: string,
    updates: {
      status?: string;
      reviewed_at?: string;
      knowledge_item_id?: string | null;
      question?: string;
      answer?: string;
      category?: string | null;
      updated_at?: string;
    },
  ): Promise<void> {
    if (isDemoMode()) return;
    try {
      const { error } = await this.client
        .from('knowledge_learning_queue')
        .update(updates)
        .eq('id', id);

      if (error) throw new RepositoryError('update learning item', error.message, error.code);
    } catch (err) {
      console.error('[KnowledgeLearningRepository] updateItem error:', err);
      // Silent fail
    }
  }

  async updateItemBatch(
    ids: string[],
    updates: {
      status?: string;
      reviewed_at?: string;
      knowledge_item_id?: string | null;
      updated_at?: string;
    },
  ): Promise<void> {
    if (isDemoMode()) return;
    try {
      const { error } = await this.client
        .from('knowledge_learning_queue')
        .update(updates)
        .in('id', ids);

      if (error) throw new RepositoryError('batch update learning items', error.message, error.code);
    } catch (err) {
      console.error('[KnowledgeLearningRepository] updateItemBatch error:', err);
      // Silent fail
    }
  }
}
