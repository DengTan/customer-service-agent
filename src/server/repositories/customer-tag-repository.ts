import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface CustomerTagFilters {
  [key: string]: unknown;
}

export interface CreateCustomerTagInput {
  name: string;
  color?: string;
  category?: string;
}

export interface UpdateCustomerTagInput {
  id: string;
  name?: string;
  color?: string;
  category?: string;
}

export class CustomerTagRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(_filters: CustomerTagFilters = {}): Promise<unknown[]> {
    if (isDemoMode()) {
      return [
        { id: 'demo-ctag-1', name: 'VIP', color: '#FF6B35', category: 'auto', is_system: true, customer_count: 156, created_at: '2026-01-01T00:00:00Z' },
        { id: 'demo-ctag-2', name: '高频', color: '#2F6BFF', category: 'auto', is_system: false, customer_count: 89, created_at: '2026-01-01T00:00:00Z' },
        { id: 'demo-ctag-3', name: '退换货', color: '#FF4444', category: 'manual', is_system: false, customer_count: 34, created_at: '2026-02-10T00:00:00Z' },
        { id: 'demo-ctag-4', name: '新客户', color: '#4CAF50', category: 'auto', is_system: false, customer_count: 210, created_at: '2026-03-01T00:00:00Z' },
      ];
    }
    const { data, error } = await this.client
      .from('customer_tags')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw new RepositoryError('list customer tags', error.message, error.code);
    }

    return data ?? [];
  }

  async create(input: CreateCustomerTagInput): Promise<unknown> {
    if (isDemoMode()) return { id: 'demo-ctag-new', name: input.name, color: input.color ?? '#2F6BFF', category: input.category ?? 'manual', is_system: false, customer_count: 0, created_at: new Date().toISOString() };
    const { data, error } = await this.client
      .from('customer_tags')
      .insert({
        name: input.name,
        color: input.color ?? '#2F6BFF',
        category: input.category ?? 'manual',
        is_system: false,
      })
      .select()
      .single();

    if (error) {
      throw new RepositoryError('create customer tag', error.message, error.code);
    }

    return data;
  }

  async update(input: UpdateCustomerTagInput): Promise<unknown> {
    if (isDemoMode()) return { id: input.id, name: input.name, color: input.color, category: input.category };
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.color !== undefined) updates.color = input.color;
    if (input.category !== undefined) updates.category = input.category;

    const { data, error } = await this.client
      .from('customer_tags')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) {
      throw new RepositoryError('update customer tag', error.message, error.code);
    }

    return data;
  }

  async delete(id: string): Promise<{ isSystem: boolean }> {
    if (isDemoMode()) return { isSystem: false };
    const { data: tag, error: fetchError } = await this.client
      .from('customer_tags')
      .select('is_system')
      .eq('id', id)
      .single();

    if (fetchError) {
      throw new RepositoryError('find customer tag by id', fetchError.message, fetchError.code);
    }

    const { error } = await this.client.from('customer_tags').delete().eq('id', id);

    if (error) {
      throw new RepositoryError('delete customer tag', error.message, error.code);
    }

    return { isSystem: tag?.is_system ?? false };
  }

  async findById(id: string): Promise<unknown | null> {
    const { data, error } = await this.client
      .from('customer_tags')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new RepositoryError('find customer tag by id', error.message, error.code);
    }

    return data;
  }

  async isSystemTag(id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('customer_tags')
      .select('is_system')
      .eq('id', id)
      .single();

    if (error) {
      throw new RepositoryError('check system tag', error.message, error.code);
    }

    return data?.is_system ?? false;
  }
}
