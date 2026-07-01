import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { Customer } from '@/lib/types';
import { RepositoryError } from './repository-error';
import { DEMO_CUSTOMERS } from './demo-data/demo-customers';
export interface CustomerFilters {
  search?: string;
  platform?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
  includeAnonymous?: boolean; // 是否包含匿名访客客户，默认 false
}

export interface CreateCustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  source_platform?: string;
  external_id?: string | null; // 平台外部用户 ID（如千牛 buyerOpenId、web visitor_id）
  platform_connection_id?: string | null; // 平台连接 ID（区分跨店铺）
  is_anonymous?: boolean; // 是否为 Web 匿名访客自动创建的客户
  conversation_count?: number; // 初始对话数，新客户默认为 0
  tags?: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateCustomerInput {
  id: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  is_anonymous?: boolean | null; // 坐席补充信息后改为 false
  tags?: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  source_platform: string;
  external_id: string | null;
  platform_connection_id: string | null;
  is_anonymous: boolean;
  tags: string[];
  metadata: Record<string, unknown> | null;
  notes: string | null;
  conversation_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string | null;
}

export class CustomerRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: CustomerFilters = {}): Promise<{ customers: unknown[]; total: number; page: number; pageSize: number }> {
    if (isDemoMode()) {
      const filtered = filters.includeAnonymous ? DEMO_CUSTOMERS : DEMO_CUSTOMERS.filter((c) => !c.is_anonymous);
      return { customers: filtered as unknown[], total: filtered.length, page: filters.page ?? 1, pageSize: filters.pageSize ?? 20 };
    }
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;

    let query = this.client
      .from('customers')
      .select('*', { count: 'exact' })
      .order('last_seen_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    // 默认过滤匿名客户
    if (!filters.includeAnonymous) {
      query = query.eq('is_anonymous', false);
    }

    if (filters.search) {
      const escaped = filters.search.replace(/[%_\\]/g, (ch) => `\\${ch}`);
      query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`);
    }
    if (filters.platform) {
      query = query.eq('source_platform', filters.platform);
    }
    if (filters.tag) {
      // Use contains for JSONB array to check if it contains the tag
      query = query.contains('tags', filters.tag);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new RepositoryError('list customers', error.message, error.code);
    }

    return { customers: data ?? [], total: count ?? 0, page, pageSize };
  }

  async create(input: CreateCustomerInput): Promise<unknown> {
    if (isDemoMode()) {
      return {
        id: `demo-cust-${Date.now()}`,
        name: input.name,
        phone: input.phone,
        email: input.email,
        source_platform: input.source_platform ?? 'web',
        external_id: input.external_id ?? null,
        platform_connection_id: input.platform_connection_id ?? null,
        is_anonymous: input.is_anonymous ?? false,
        tags: input.tags ?? [],
        notes: input.notes,
        metadata: input.metadata ?? null,
        conversation_count: 0,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: null,
      };
    }
    const { data, error } = await this.client
      .from('customers')
      .insert({
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        source_platform: input.source_platform ?? 'web',
        external_id: input.external_id ?? null,
        platform_connection_id: input.platform_connection_id ?? null,
        is_anonymous: input.is_anonymous ?? false,
        conversation_count: input.conversation_count ?? 1, // 新客户首次进线 → 1
        tags: input.tags ?? [],
        notes: input.notes ?? null,
        metadata: input.metadata ?? null,
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create customer', error.message, error.code);
    }

    return data;
  }

  async update(input: UpdateCustomerInput): Promise<unknown> {
    if (isDemoMode()) return { id: input.id, name: input.name, tags: input.tags, notes: input.notes, is_anonymous: input.is_anonymous };
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.phone !== undefined) updates.phone = input.phone;
    if (input.email !== undefined) updates.email = input.email;
    if (input.is_anonymous !== undefined && input.is_anonymous !== null) updates.is_anonymous = input.is_anonymous;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.metadata !== undefined) updates.metadata = input.metadata;

    const { data, error } = await this.client
      .from('customers')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('update customer', error.message, error.code);
    }

    // 当 tags 更新时，同步标签计数（Fire-and-forget）
    if (input.tags !== undefined) {
      this.syncTagCounts(input.tags).catch(() => {});
    }

    return data;
  }

  /**
   * 同步标签计数：将给定标签名称数组对应的 customer_tags 记录重新计算 customer_count
   */
  private async syncTagCounts(tagNames: string[]): Promise<void> {
    try {
      await this.client.rpc('update_customer_tag_counts_batch', {
        tag_names: tagNames,
      });
    } catch (err) {
      // 静默失败，不阻断主流程，但记录日志便于排查
      console.error('[CustomerRepository] Failed to sync tag counts:', err);
    }
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.from('customers').delete().eq('id', id);

    if (error) {
      throw new RepositoryError('delete customer', error.message, error.code);
    }
  }

  async findById(id: string): Promise<unknown | null> {
    if (isDemoMode()) return { id, name: '演示客户', phone: '138****0000', email: 'demo@example.com', source_platform: 'web', tags: [], notes: null, conversations: [] };
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new RepositoryError('find customer by id', error.message, error.code);
    }

    return data;
  }

  async getWithConversations(id: string): Promise<{ customer: unknown; conversations: unknown[] }> {
    const { data: customer, error } = await this.client
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new RepositoryError('find customer by id', error.message, error.code);
    }

    if (!customer) {
      return { customer: null, conversations: [] };
    }

    const { data: relations } = await this.client
      .from('customer_conversations')
      .select('conversation_id, conversations(id, title, status, created_at, updated_at)')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    const conversations = relations
      ?.map((r: Record<string, unknown>) => r.conversations)
      .filter(Boolean) || [];

    return { customer, conversations };
  }

  /**
   * 按平台 + 外部用户ID + 店铺连接ID 查找已有客户
   * 用于识别回头客：同一买家多次进线时复用同一客户记录
   * platformConnectionId 为 null/undefined 时匹配 NULL 值（Web 访客无店铺维度）
   */
  async findByExternalId(
    sourcePlatform: string,
    externalId: string,
    platformConnectionId: string | null = null,
  ): Promise<CustomerRow | null> {
    if (isDemoMode()) return null;
    let query = this.client
      .from('customers')
      .select('*')
      .eq('source_platform', sourcePlatform)
      .eq('external_id', externalId);

    if (platformConnectionId) {
      query = query.eq('platform_connection_id', platformConnectionId);
    } else {
      query = query.is('platform_connection_id', null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new RepositoryError('find customer by external id', error.message, error.code);
    }
    return (data as CustomerRow | null) ?? null;
  }

  /**
   * 幂等关联客户与对话。重复调用不会报错。
   * 利用 customer_conversations 联合唯一索引 + 捕获 unique_violation 错误码
   */
  async linkConversation(customerId: string, conversationId: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('customer_conversations')
      .insert({ customer_id: customerId, conversation_id: conversationId });

    // 23505 = unique_violation, 重复关联时跳过
    if (error && error.code !== '23505') {
      throw new RepositoryError('link customer to conversation', error.message, error.code);
    }
  }

  /**
   * 原子自增客户对话计数 + 更新最后活跃时间
   * 通过 RPC 函数实现真正的原子操作（行级锁），并发安全
   */
  async incrementConversationCount(customerId: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.rpc('increment_customer_conversation_count', {
      p_customer_id: customerId,
    });
    if (error) {
      throw new RepositoryError('increment conversation count', error.message, error.code);
    }
  }

  /**
   * 通过 conversation_id 查找关联客户（用于对话详情页展示）
   */
  async findByConversationId(conversationId: string): Promise<Customer | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('customer_conversations')
      .select(`
        customer:customers (
          id, name, phone, email, source_platform, external_id,
          platform_connection_id, is_anonymous, tags, notes, metadata,
          conversation_count, first_seen_at, last_seen_at, created_at, updated_at
        )
      `)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (error) {
      throw new RepositoryError('find customer by conversation id', error.message, error.code);
    }
    // Supabase join 返回单条时仍是数组，取第一条
    const customerData = (data as { customer?: Customer | Customer[] | null })?.customer;
    if (Array.isArray(customerData)) {
      return customerData[0] ?? null;
    }
    return customerData ?? null;
  }

  /**
   * 按标签名查询客户列表（支持分页）
   * 用于标签详情页展示使用该标签的所有客户
   */
  async findByTag(tagName: string, limit = 10, offset = 0): Promise<{ customers: CustomerRow[]; total: number }> {
    if (isDemoMode()) {
      const filtered = (DEMO_CUSTOMERS as unknown as CustomerRow[]).filter((c) => c.tags?.includes(tagName));
      return {
        customers: filtered.slice(offset, offset + limit),
        total: filtered.length,
      };
    }

    const { data, error, count } = await this.client
      .from('customers')
      .select('*', { count: 'exact' })
      .contains('tags', tagName)
      .order('last_seen_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new RepositoryError('find customers by tag', error.message, error.code);
    }

    return {
      customers: (data ?? []) as CustomerRow[],
      total: count ?? 0,
    };
  }
}
