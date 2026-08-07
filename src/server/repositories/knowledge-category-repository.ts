import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { logger } from '@/lib/logger';

export interface KnowledgeCategory {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  description: string | null;
  item_count: number;
  created_at: string;
  updated_at: string | null;
}

export class KnowledgeCategoryRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(input: {
    name: string;
    color?: string;
    description?: string;
    sort_order?: number;
  }): Promise<KnowledgeCategory> {
    if (isDemoMode()) {
      return {
        id: 'demo-cat-' + Date.now(),
        name: input.name,
        color: input.color || '#6366f1',
        sort_order: input.sort_order || 0,
        description: input.description || null,
        item_count: 0,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
    }
    const { data, error } = await this.client
      .from('knowledge_categories')
      .insert({
        name: input.name,
        color: input.color || '#6366f1',
        sort_order: input.sort_order || 0,
        description: input.description || null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create category', error.message, error.code);
    return data as KnowledgeCategory;
  }

  async findById(id: string): Promise<KnowledgeCategory | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('knowledge_categories')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new RepositoryError('find category', error.message, error.code);
    return data as KnowledgeCategory | null;
  }

  async findByName(name: string): Promise<KnowledgeCategory | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('knowledge_categories')
      .select('*')
      .eq('name', name)
      .maybeSingle();
    if (error) throw new RepositoryError('find category by name', error.message, error.code);
    return data as KnowledgeCategory | null;
  }

  async update(id: string, input: {
    name?: string;
    color?: string;
    description?: string;
    sort_order?: number;
  }): Promise<KnowledgeCategory> {
    if (isDemoMode()) {
      return {
        id,
        name: input.name || '',
        color: input.color || '#6366f1',
        sort_order: input.sort_order || 0,
        description: input.description || null,
        item_count: 0,
        created_at: '',
        updated_at: new Date().toISOString(),
      };
    }
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.color !== undefined) updateData.color = input.color;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.sort_order !== undefined) updateData.sort_order = input.sort_order;

    const { data, error } = await this.client
      .from('knowledge_categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update category', error.message, error.code);
    return data as KnowledgeCategory;
  }

  async delete(id: string): Promise<number> {
    if (isDemoMode()) return 0;

    // First, set category_id to NULL for all related knowledge_items
    await this.client
      .from('knowledge_items')
      .update({
        category_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('category_id', id);

    const { error } = await this.client
      .from('knowledge_categories')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete category', error.message, error.code);

    return 1;
  }

  async list(): Promise<KnowledgeCategory[]> {
    if (isDemoMode()) {
      return [
        { id: 'demo-1', name: '产品相关', color: '#6366f1', sort_order: 1, description: null, item_count: 5, created_at: '', updated_at: null },
        { id: 'demo-2', name: '物流相关', color: '#8b5cf6', sort_order: 2, description: null, item_count: 3, created_at: '', updated_at: null },
        { id: 'demo-3', name: '售后相关', color: '#ec4899', sort_order: 3, description: null, item_count: 2, created_at: '', updated_at: null },
        { id: 'demo-4', name: '支付相关', color: '#f59e0b', sort_order: 4, description: null, item_count: 1, created_at: '', updated_at: null },
      ];
    }
    const { data, error } = await this.client
      .from('knowledge_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new RepositoryError('list categories', error.message, error.code);
    return (data || []) as KnowledgeCategory[];
  }

  async updateItemCount(id: string, delta: number): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client.rpc('increment_knowledge_category_count', {
      cat_id: id,
      delta: delta,
    });
    if (error) {
      // Fallback: do it manually
      const category = await this.findById(id);
      if (category) {
        await this.client
          .from('knowledge_categories')
          .update({ item_count: Math.max(0, category.item_count + delta) })
          .eq('id', id);
      }
    }
  }

  /**
   * Recompute item_count from knowledge_items and update the category.
   * This is the preferred method for category operations that involve
   * bulk changes (delete with set_null), where delta counting is inaccurate.
   */
  async recomputeItemCount(id: string): Promise<void> {
    if (isDemoMode()) return;
    try {
      const { count, error } = await this.client
        .from('knowledge_items')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id)
        .neq('status', 'deleted');
      if (error) {
        logger.warn('[KnowledgeCategoryRepository] recomputeItemCount query failed', { categoryId: id, error });
        return;
      }
      await this.client
        .from('knowledge_categories')
        .update({ item_count: count ?? 0 })
        .eq('id', id);
    } catch (err) {
      logger.warn('[KnowledgeCategoryRepository] recomputeItemCount failed', { categoryId: id, error: err });
    }
  }
}
