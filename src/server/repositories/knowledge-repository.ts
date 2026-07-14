import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_ITEMS } from './demo-data/demo-knowledge';
import { escapeLikePattern } from '@/lib/api-utils';

export interface KnowledgeItemFilters {
  status?: string;
  category?: string;
  search?: string;
  [key: string]: unknown;
}

export interface KnowledgeItem {
  id: string;
  name: string;
  title?: string;
  type: string;
  content: string | null;
  content_hash: string | null;
  doc_ids: string[];
  category: string;
  parent_category: string | null;
  status: string;
  chunk_count: number;
  hit_count: number;
  last_hit_at: string | null;
  adopted_count: number;
  rejected_count: number;
  archived_at: string | null;
  expires_at: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface KnowledgeItemWithNormalized extends KnowledgeItem {
  name: string;
  type: string;
  category: string;
  parent_category: string | null;
  image_url: string | null;
  content_hash: string | null;
  hit_count: number;
  last_hit_at: string | null;
  adopted_count: number;
  rejected_count: number;
  archived_at: string | null;
  expires_at: string | null;
}

export interface UpdateKnowledgeItemInput {
  id: string;
  name?: string;
  content?: string;
  category?: string;
  parent_category?: string | null;
  doc_ids?: string[];
  chunk_count?: number;
  image_url?: string | null;
  archived_at?: string | null;
  expires_at?: string | null;
}

export interface ListItemsOptions {
  includeArchived?: boolean;
  onlyArchived?: boolean;
  includeExpired?: boolean;
}

export interface KnowledgeVersionFilters {
  item_id?: string;
}

export interface CreateVersionInput {
  item_id: string;
  title: string;
  content: string;
  change_summary?: string | null;
  created_by?: string | null;
  chunk_diff?: unknown;
  chunk_count?: number;
}

export interface RollbackInput {
  version_id: string;
  created_by?: string | null;
}

export interface VersionWithCreator {
  id: string;
  knowledge_item_id: string;
  version: number;
  title: string;
  content: string;
  change_summary: string | null;
  created_by: string | null;
  chunk_diff: Record<string, unknown> | null;
  chunk_count: number | null;
  created_at: string;
  creator_name: string | null;
}

export class KnowledgeRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * P1-6: 返回仅含 1 条 stub item。仅作为向后兼容的旧接口保留
   * @deprecated 返回仅含 1 条 stub item。新调用方应使用 listItemsPage+countItems+aggregateCategories 或 service.listItems。
   */
  async listItems(_filters: KnowledgeItemFilters = {}, options: ListItemsOptions = {}): Promise<{ items: KnowledgeItemWithNormalized[]; categories: Record<string, number>; categoryTree: Record<string, { count: number; children: Record<string, number> }>; total: number }> {
    // Backwards-compatible thin wrapper. Returns the first 1 row only when no filters applied.
    // Callers needing pagination should use listItemsPage + countItems + aggregateCategories directly via service.listItems().
    const page = await this.listItemsPage(_filters, options, 0, 1);
    const total = await this.countItems(_filters, options);
    const { categories, categoryTree } = await this.aggregateCategories(_filters, options);
    return { items: page, categories, categoryTree, total };
  }

  async listItemsPage(filters: KnowledgeItemFilters = {}, options: ListItemsOptions = {}, offset = 0, limit = 20): Promise<KnowledgeItemWithNormalized[]> {
    if (isDemoMode()) {
      return this.demoListItemsPage(filters, options, offset, limit);
    }

    let query = this.client
      .from('knowledge_items')
      .select('*')
      .neq('status', 'deleted');

    query = this.applyFilters(query, filters, options);
    query = query.order('archived_at', { ascending: true }).order('created_at', { ascending: false });
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) {
      throw new RepositoryError('list knowledge items page', error.message, error.code);
    }

    // P1-4: expired 过滤已由 applyFilters 推到 SQL，JS 层不再重复过滤
    return (data || []).map((item: Record<string, unknown>) => this.normalizeItem(item));
  }

  async countItems(filters: KnowledgeItemFilters = {}, options: ListItemsOptions = {}): Promise<number> {
    if (isDemoMode()) {
      return this.demoFilteredItems(filters, options).length;
    }

    let query = this.client
      .from('knowledge_items')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'deleted');

    query = this.applyFilters(query, filters, options);

    const { count, error } = await query;
    if (error) {
      throw new RepositoryError('count knowledge items', error.message, error.code);
    }
    return count ?? 0;
  }

  async aggregateCategories(filters: KnowledgeItemFilters = {}, options: ListItemsOptions = {}): Promise<{
    categories: Record<string, number>;
    categoryTree: Record<string, { count: number; children: Record<string, number> }>;
  }> {
    if (isDemoMode()) {
      return this.demoAggregateCategories(filters, options);
    }

    let query = this.client
      .from('knowledge_items')
      .select('category, parent_category')
      .neq('status', 'deleted');

    query = this.applyFilters(query, filters, options);

    const { data, error } = await query;
    if (error) {
      throw new RepositoryError('aggregate categories', error.message, error.code);
    }

    const categories: Record<string, number> = {};
    const categoryTree: Record<string, { count: number; children: Record<string, number> }> = {};
    (data || []).forEach((row: Record<string, unknown>) => {
      const cat = ((row.category as string) || '未分类') as string;
      const parentCat = (row.parent_category as string) || null;
      categories[cat] = (categories[cat] || 0) + 1;

      if (parentCat) {
        if (!categoryTree[parentCat]) categoryTree[parentCat] = { count: 0, children: {} };
        categoryTree[parentCat].children[cat] = (categoryTree[parentCat].children[cat] || 0) + 1;
        categoryTree[parentCat].count += 1;
      } else {
        if (!categoryTree[cat]) categoryTree[cat] = { count: 0, children: {} };
        categoryTree[cat].count += 1;
      }
    });

    return { categories, categoryTree };
  }

  async listAllIds(filters: KnowledgeItemFilters = {}, options: ListItemsOptions = {}): Promise<string[]> {
    if (isDemoMode()) {
      return this.demoFilteredItems(filters, options).map(i => i.id);
    }

    let query = this.client
      .from('knowledge_items')
      .select('id')
      .neq('status', 'deleted');

    query = this.applyFilters(query, filters, options);

    const { data, error } = await query;
    if (error) {
      throw new RepositoryError('list all knowledge ids', error.message, error.code);
    }
    return (data || []).map((row: Record<string, unknown>) => row.id as string);
  }

  /**
   * Shared filter applier used by listItemsPage / countItems / aggregateCategories / listAllIds.
   * Keeps status / category / search / includeArchived / includeExpired in one place.
   */
  private applyFilters(query: any, filters: KnowledgeItemFilters, options: ListItemsOptions): any {
    if (options.onlyArchived) {
      query = query.not('archived_at', 'is', null);
    } else if (!options.includeArchived) {
      query = query.is('archived_at', null);
    }

    // P1-4: expired 过滤推到 SQL（expires_at 为 null 或大于当前时间视为有效）
    if (!options.includeExpired) {
      query = query.or('expires_at.is.null,expires_at.gt.now()');
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.search) {
      const escaped = escapeLikePattern(filters.search);
      // P1-5: 搜索扩展到 name + title + content（content.ilike 可能慢，已知）
      query = query.or(`name.ilike.%${escaped}%,title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
    }

    return query;
  }

  private normalizeItem(item: Record<string, unknown>): KnowledgeItemWithNormalized {
    return {
      ...item,
      name: (item.name || item.title || '未命名') as string,
      type: (item.type || 'text') as string,
      category: ((item.category as string) || '未分类') as string,
      parent_category: (item.parent_category as string) || null,
      content_hash: (item.content_hash as string) || null,
      hit_count: (item.hit_count as number) || 0,
      last_hit_at: (item.last_hit_at as string) || null,
      adopted_count: (item.adopted_count as number) || 0,
      rejected_count: (item.rejected_count as number) || 0,
      archived_at: (item.archived_at as string) || null,
      expires_at: (item.expires_at as string) || null,
    } as KnowledgeItemWithNormalized;
  }

  private demoApplyFilters(filters: KnowledgeItemFilters, options: ListItemsOptions): KnowledgeItemWithNormalized[] {
    const now = Date.now();
    return DEMO_ITEMS.filter((item) => {
      if (item.status === 'deleted') return false;
      if (options.onlyArchived) {
        if (!item.archived_at) return false;
      } else if (!options.includeArchived) {
        if (item.archived_at) return false;
      }
      if (!options.includeExpired && item.expires_at && new Date(item.expires_at).getTime() < now) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.search) {
        const lowered = filters.search.toLowerCase();
        const hit = (item.name || item.title || '').toLowerCase().includes(lowered);
        if (!hit) return false;
      }
      return true;
    }) as KnowledgeItemWithNormalized[];
  }

  private demoFilteredItems(filters: KnowledgeItemFilters, options: ListItemsOptions): KnowledgeItemWithNormalized[] {
    return this.demoApplyFilters(filters, options);
  }

  private demoListItemsPage(filters: KnowledgeItemFilters, options: ListItemsOptions, offset: number, limit: number): KnowledgeItemWithNormalized[] {
    const filtered = this.demoFilteredItems(filters, options);
    return filtered
      .slice()
      .sort((a, b) => {
        const aArchived = a.archived_at ? 1 : 0;
        const bArchived = b.archived_at ? 1 : 0;
        if (aArchived !== bArchived) return aArchived - bArchived;
        const aCreated = a.created_at || '';
        const bCreated = b.created_at || '';
        return bCreated.localeCompare(aCreated);
      })
      .slice(offset, offset + limit);
  }

  private demoAggregateCategories(filters: KnowledgeItemFilters, options: ListItemsOptions): {
    categories: Record<string, number>;
    categoryTree: Record<string, { count: number; children: Record<string, number> }>;
  } {
    const filtered = this.demoFilteredItems(filters, options);
    const categories: Record<string, number> = {};
    const categoryTree: Record<string, { count: number; children: Record<string, number> }> = {};
    filtered.forEach((item) => {
      const cat = item.category || '未分类';
      const parentCat = item.parent_category || null;
      categories[cat] = (categories[cat] || 0) + 1;

      if (parentCat) {
        if (!categoryTree[parentCat]) categoryTree[parentCat] = { count: 0, children: {} };
        categoryTree[parentCat].children[cat] = (categoryTree[parentCat].children[cat] || 0) + 1;
        categoryTree[parentCat].count += 1;
      } else {
        if (!categoryTree[cat]) categoryTree[cat] = { count: 0, children: {} };
        categoryTree[cat].count += 1;
      }
    });
    return { categories, categoryTree };
  }

  async findItemById(id: string): Promise<KnowledgeItem | null> {
    if (isDemoMode()) {
      const items = await this.listItemsPage({}, { includeArchived: false, includeExpired: false }, 0, 10000);
      return items.find(i => i.id === id) ?? null;
    }
    const { data, error } = await this.client
      .from('knowledge_items')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find knowledge item by id', error.message, error.code);
    }

    return data as KnowledgeItem | null;
  }

  async findItemsByIds(ids: string[]): Promise<KnowledgeItem[]> {
    if (ids.length === 0) return [];
    if (isDemoMode()) {
      const items = await this.listItemsPage({}, { includeArchived: false, includeExpired: false }, 0, 10000);
      return items.filter(i => ids.includes(i.id));
    }
    const { data, error } = await this.client
      .from('knowledge_items')
      .select('*')
      .in('id', ids);

    if (error) {
      throw new RepositoryError('find items by ids', error.message, error.code);
    }

    return (data || []) as KnowledgeItem[];
  }

  async updateItem(input: UpdateKnowledgeItemInput): Promise<void> {
    if (isDemoMode()) return;
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.content !== undefined) updateData.content = input.content;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.parent_category !== undefined) updateData.parent_category = input.parent_category;
    if (input.doc_ids !== undefined) updateData.doc_ids = input.doc_ids;
    if (input.chunk_count !== undefined) updateData.chunk_count = input.chunk_count;
    if (input.image_url !== undefined) updateData.image_url = input.image_url;
    if (input.archived_at !== undefined) updateData.archived_at = input.archived_at;
    if (input.expires_at !== undefined) updateData.expires_at = input.expires_at;

    const { error } = await this.client
      .from('knowledge_items')
      .update(updateData)
      .eq('id', input.id);

    if (error) {
      throw new RepositoryError('update knowledge item', error.message, error.code);
    }
  }

  async deleteItem(id: string): Promise<void> {
    if (isDemoMode()) return;
    // 物理删除：先删关联 chunks，再删条目
    await this.client.from('knowledge_chunks').delete().eq('knowledge_item_id', id);
    const { error } = await this.client.from('knowledge_items').delete().eq('id', id);
    if (error) {
      throw new RepositoryError('delete knowledge item', error.message, error.code);
    }
  }

  async listVersions(filters: KnowledgeVersionFilters): Promise<VersionWithCreator[]> {
    if (isDemoMode()) {
      if (!filters.item_id) return [];
      return [
        { id: 'demo-ver-1', knowledge_item_id: filters.item_id, version: 2, title: '退换货政策', content: '7天无理由退换货...', change_summary: '更新退换货时限', created_by: null, chunk_diff: null, chunk_count: 3, created_at: '2026-06-01T00:00:00Z', creator_name: null },
        { id: 'demo-ver-2', knowledge_item_id: filters.item_id, version: 1, title: '退换货政策', content: '15天无理由退换货...', change_summary: '初始版本', created_by: null, chunk_diff: null, chunk_count: 2, created_at: '2026-01-01T00:00:00Z', creator_name: null },
      ];
    }
    if (!filters.item_id) {
      throw new RepositoryError('list versions', 'item_id is required');
    }

    const { data: versions, error } = await this.client
      .from('knowledge_versions')
      .select('id, knowledge_item_id, version, title, content, change_summary, created_by, chunk_diff, chunk_count, created_at')
      .eq('knowledge_item_id', filters && filters.item_id)
      .order('version', { ascending: false });

    if (error) {
      throw new RepositoryError('list versions', error.message, error.code);
    }

    // Fix N+1 query: batch fetch all creators instead of one query per version
    type VersionRow = Omit<VersionWithCreator, 'creator_name'>;
    const versionsList = (versions as VersionRow[] | null) ?? [];
    const creatorIds = [...new Set(versionsList.map(v => v.created_by).filter((id): id is string => Boolean(id)))];

    let userMap: Map<string, string> = new Map();
    if (creatorIds.length > 0) {
      const { data: users } = await this.client
        .from('users')
        .select('id, name')
        .in('id', creatorIds);

      if (users) {
        userMap = new Map((users as Array<{ id: string; name: string }>).map(u => [u.id, u.name]));
      }
    }

    const enrichedVersions: VersionWithCreator[] = versionsList.map((v) => ({
      ...v,
      creator_name: v.created_by ? userMap.get(v.created_by) ?? null : null,
    }));

    return enrichedVersions;
  }

  async getLatestVersion(itemId: string): Promise<number> {
    if (isDemoMode()) return 2;
    const { data: latestVersion } = await this.client
      .from('knowledge_versions')
      .select('version')
      .eq('knowledge_item_id', itemId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    return ((latestVersion as { version: number } | null)?.version || 0);
  }

  async createVersion(input: CreateVersionInput): Promise<unknown> {
    if (isDemoMode()) return { id: 'demo-ver-new', version: 3, title: input.title, content: input.content };
    const nextVersion = await this.getLatestVersion(input.item_id) + 1;

    const { data: version, error } = await this.client
      .from('knowledge_versions')
      .insert({
        knowledge_item_id: input.item_id,
        version: nextVersion,
        title: input.title,
        content: input.content,
        change_summary: input.change_summary ?? null,
        created_by: input.created_by ?? null,
        chunk_diff: (input as { chunk_diff?: unknown }).chunk_diff ?? null,
        chunk_count: (input as { chunk_count?: number }).chunk_count ?? null,
      })
      .select('id, knowledge_item_id, version, title, content, change_summary, created_by, chunk_diff, chunk_count, created_at')
      .single();

    if (error) {
      throw new RepositoryError('create version', error.message, error.code);
    }

    return version;
  }

  async findVersionById(versionId: string): Promise<{
    id: string;
    knowledge_item_id: string;
    version: number;
    title: string;
    content: string;
  } | null> {
    if (isDemoMode()) return { id: versionId, knowledge_item_id: 'demo-ki-1', version: 1, title: '退换货政策', content: '7天无理由退换货...' };
    const { data, error } = await this.client
      .from('knowledge_versions')
      .select('id, knowledge_item_id, version, title, content')
      .eq('id', versionId)
      .maybeSingle();

    if (error) {
      throw new RepositoryError('find version by id', error.message, error.code);
    }

    return data as {
      id: string;
      knowledge_item_id: string;
      version: number;
      title: string;
      content: string;
    } | null;
  }

  async rollbackToVersion(input: RollbackInput): Promise<unknown> {
    if (isDemoMode()) return { id: 'demo-ver-new', version: 3, title: '回滚版本', content: '回滚内容' };
    const targetVersion = await this.findVersionById(input.version_id);
    if (!targetVersion) {
      throw new RepositoryError('rollback', 'version not found');
    }

    const nextVersion = await this.getLatestVersion(targetVersion.knowledge_item_id) + 1;

    const { data: newVersion, error: insertError } = await this.client
      .from('knowledge_versions')
      .insert({
        knowledge_item_id: targetVersion.knowledge_item_id,
        version: nextVersion,
        title: targetVersion.title,
        content: targetVersion.content,
        change_summary: `回滚至版本 v${targetVersion.version}`,
        created_by: input.created_by ?? null,
      })
      .select('id, knowledge_item_id, version, title, content, change_summary, created_by, created_at')
      .single();

    if (insertError) {
      throw new RepositoryError('rollback insert', insertError.message, insertError.code);
    }

    await this.client
      .from('knowledge_items')
      .update({
        title: targetVersion.title,
        content: targetVersion.content,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetVersion.knowledge_item_id);

    return newVersion;
  }

  async updateKnowledgeItemContent(itemId: string, title: string, content: string, chunkCount?: number): Promise<void> {
    if (isDemoMode()) return;
    const updateData: Record<string, unknown> = {
      title,
      content,
      updated_at: new Date().toISOString(),
    };
    if (chunkCount !== undefined) {
      updateData.chunk_count = chunkCount;
    }
    await this.client
      .from('knowledge_items')
      .update(updateData)
      .eq('id', itemId);
  }

  // ============================================================
  // 生命周期与批量编辑（archive / unarchive / bulk / merge）
  // ============================================================

  async archiveItem(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('knowledge_items')
      .update({ archived_at: new Date().toISOString(), status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new RepositoryError('archive knowledge item', error.message, error.code);
  }

  async unarchiveItem(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('knowledge_items')
      .update({ archived_at: null, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new RepositoryError('unarchive knowledge item', error.message, error.code);
  }

  async bulkArchive(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    if (isDemoMode()) return ids.length;
    const { data, error } = await this.client
      .from('knowledge_items')
      .update({ archived_at: new Date().toISOString(), status: 'archived', updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');
    if (error) throw new RepositoryError('bulk archive', error.message, error.code);
    return (data || []).length;
  }

  async bulkUnarchive(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    if (isDemoMode()) return ids.length;
    const { data, error } = await this.client
      .from('knowledge_items')
      .update({ archived_at: null, status: 'active', updated_at: new Date().toISOString() })
      .in('id', ids)
      .select('id');
    if (error) throw new RepositoryError('bulk unarchive', error.message, error.code);
    return (data || []).length;
  }

  async bulkUpdateCategory(ids: string[], category: string, parentCategory?: string | null): Promise<number> {
    if (ids.length === 0) return 0;
    if (isDemoMode()) return ids.length;
    const update: Record<string, unknown> = { category, updated_at: new Date().toISOString() };
    if (parentCategory !== undefined) {
      update.parent_category = parentCategory;
    }
    const { data, error } = await this.client
      .from('knowledge_items')
      .update(update)
      .in('id', ids)
      .select('id');
    if (error) throw new RepositoryError('bulk update category', error.message, error.code);
    return (data || []).length;
  }

  async bulkDelete(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    if (isDemoMode()) return ids.length;
    // 物理删除：先删关联 chunks，再删条目
    await this.client.from('knowledge_chunks').delete().in('knowledge_item_id', ids);
    const { data, error } = await this.client
      .from('knowledge_items')
      .delete()
      .in('id', ids)
      .select('id');
    if (error) throw new RepositoryError('bulk delete', error.message, error.code);
    return (data || []).length;
  }

  /**
   * 合并分类：把 fromCategory 下的所有条目改为 toCategory，fromCategory 消失
   * 不支持合并到已存在的分类（避免循环），目标分类必须已存在于 knowledge_items 中
   */
  async mergeCategory(fromCategory: string, toCategory: string, toParentCategory?: string | null): Promise<number> {
    if (!fromCategory || !toCategory || fromCategory === toCategory) return 0;
    if (isDemoMode()) return 0;
    const update: Record<string, unknown> = { category: toCategory, updated_at: new Date().toISOString() };
    if (toParentCategory !== undefined) {
      update.parent_category = toParentCategory;
    }
    const { data, error } = await this.client
      .from('knowledge_items')
      .update(update)
      .eq('category', fromCategory)
      .neq('status', 'deleted')
      .select('id');
    if (error) throw new RepositoryError('merge category', error.message, error.code);
    return (data || []).length;
  }

  /**
   * 列出所有已存在的一级分类（含已使用、已归档），用于合并分类的下拉选择
   */
  async listAllCategories(): Promise<Array<{ category: string; parent_category: string | null; count: number }>> {
    if (isDemoMode()) {
      return [
        { category: '售后', parent_category: null, count: 1 },
        { category: '物流', parent_category: null, count: 1 },
        { category: '支付', parent_category: null, count: 1 },
        { category: '会员', parent_category: null, count: 1 },
      ];
    }
    const { data, error } = await this.client
      .from('knowledge_items')
      .select('category, parent_category')
      .neq('status', 'deleted');
    if (error) throw new RepositoryError('list all categories', error.message, error.code);
    const map = new Map<string, { category: string; parent_category: string | null; count: number }>();
    (data || []).forEach((row: { category: string | null; parent_category: string | null }) => {
      const cat = row.category || '未分类';
      const key = `${cat}::${row.parent_category || ''}`;
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { category: cat, parent_category: row.parent_category, count: 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }
}
