import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_ITEMS } from './demo-data/demo-knowledge';
import { escapeLikePattern } from '@/lib/api-utils';
export interface KnowledgeItemFilters {
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

  async listItems(_filters: KnowledgeItemFilters = {}, options: ListItemsOptions = {}): Promise<{ items: KnowledgeItemWithNormalized[]; categories: Record<string, number>; categoryTree: Record<string, { count: number; children: Record<string, number> }>; total: number }> {
    if (isDemoMode()) {
      const filtered = options.includeArchived
        ? DEMO_ITEMS
        : DEMO_ITEMS.filter(i => i.status === 'active' && !i.archived_at);
      const categories: Record<string, number> = {};
      filtered.forEach(item => { categories[item.category] = (categories[item.category] || 0) + 1; });
      const categoryTree: Record<string, { count: number; children: Record<string, number> }> = {};
      Object.entries(categories).forEach(([cat, count]) => {
        categoryTree[cat] = { count, children: {} };
      });
      return { items: filtered, categories, categoryTree, total: filtered.length };
    }

    // 真实模式：根据 options 拼接过滤条件
    // 1) 默认仅查询 status != 'deleted' 的条目
    // 2) 默认排除已归档（archived_at 非空）；includeArchived=true 时返回全部
    // 3) 默认排除已过期（expires_at 已过）；includeExpired=true 时返回全部（包含未到期）
    // 4) 支持 _filters 参数过滤（status / category / search）
    let query = this.client
      .from('knowledge_items')
      .select('*')
      .neq('status', 'deleted');

    if (!options.includeArchived) {
      query = query.is('archived_at', null);
    }

    // Apply _filters (status, category, search) — mirrors real-mode pattern used in other repositories
    const filters = _filters as { status?: string; category?: string; search?: string };
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.search) {
      const escaped = escapeLikePattern(filters.search);
      query = query.or(`title.ilike.%${escaped}%,name.ilike.%${escaped}%`);
    }

    query = query.order('archived_at', { ascending: true }).order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new RepositoryError('list knowledge items', error.message, error.code);
    }

    const now = Date.now();
    const items = (data || [])
      .filter((item: Record<string, unknown>) => {
        if (!options.includeExpired && item.expires_at && new Date(item.expires_at as string).getTime() < now) {
          return false;
        }
        return true;
      })
      .map((item: Record<string, unknown>) => ({
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
      })) as KnowledgeItemWithNormalized[];

    const categories: Record<string, number> = {};
    const categoryTree: Record<string, { count: number; children: Record<string, number> }> = {};
    items.forEach((item) => {
      const cat = item.category || '未分类';
      const parentCat = item.parent_category || null;
      categories[cat] = (categories[cat] || 0) + 1;

      if (parentCat) {
        if (!categoryTree[parentCat]) categoryTree[parentCat] = { count: 0, children: {} };
        categoryTree[parentCat].children[cat] = (categoryTree[parentCat].children[cat] || 0) + 1;
        categoryTree[parentCat].count += 1;
      } else {
        // Top-level category with no parent
        if (!categoryTree[cat]) categoryTree[cat] = { count: 0, children: {} };
        categoryTree[cat].count += 1;
      }
    });

    return { items, categories, categoryTree, total: items.length };
  }

  async findItemById(id: string): Promise<KnowledgeItem | null> {
    if (isDemoMode()) {
      const items = (await this.listItems()).items;
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

  async updateItem(input: UpdateKnowledgeItemInput): Promise<void> {
    if (isDemoMode()) return;
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.content !== undefined) updateData.content = (input.content as string).slice(0, 500);
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
    const { error } = await this.client
      .from('knowledge_items')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('id', id);

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
    const versionsList = (versions as Array<Record<string, unknown>>) || [];
    const creatorIds = [...new Set(versionsList.map(v => v.created_by).filter(Boolean))] as string[];
    
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
      creator_name: v.created_by ? (userMap.get(v.created_by as string) || null) : null,
    } as VersionWithCreator));

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
      category: string | null;
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

  async updateKnowledgeItemContent(itemId: string, title: string, content: string): Promise<void> {
    if (isDemoMode()) return;
    await this.client
      .from('knowledge_items')
      .update({
        title,
        content,
        updated_at: new Date().toISOString(),
      })
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
    const { data, error } = await this.client
      .from('knowledge_items')
      .update({ status: 'deleted', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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
