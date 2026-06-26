import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { ShopRow } from './types';

export interface CreateShopInput {
  name: string;
  platform: string;
  shop_url?: string | null;
  logo_url?: string | null;
  total_accounts?: number;
  contact_name?: string | null;
  contact_phone?: string | null;
  remark?: string | null;
  knowledge_ids?: string[];
  config?: Record<string, unknown>;
  agent_quota?: number;
}

export interface UpdateShopInput {
  name?: string;
  platform?: string;
  shop_url?: string | null;
  logo_url?: string | null;
  total_accounts?: number;
  used_accounts?: number;
  status?: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  remark?: string | null;
  knowledge_ids?: string[];
  config?: Record<string, unknown>;
  agent_quota?: number;
}

export class ShopsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(): Promise<ShopRow[]> {
    if (isDemoMode()) {
      return [];
    }

    const { data, error } = await this.client
      .from('shops')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new RepositoryError('list shops', error.message, error.code);
    return (data ?? []) as ShopRow[];
  }

  async getById(id: string): Promise<ShopRow | null> {
    if (isDemoMode()) return null;

    const { data, error } = await this.client
      .from('shops')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new RepositoryError('get shop by id', error.message, error.code);
    }
    return data as ShopRow;
  }

  async create(input: CreateShopInput): Promise<ShopRow> {
    if (isDemoMode()) {
      return {
        id: `demo-shop-${Date.now()}`,
        name: input.name,
        platform: input.platform,
        shop_url: input.shop_url || null,
        logo_url: input.logo_url || null,
        total_accounts: input.total_accounts ?? 0,
        used_accounts: 0,
        status: 'active',
        contact_name: input.contact_name || null,
        contact_phone: input.contact_phone || null,
        remark: input.remark || null,
        knowledge_ids: input.knowledge_ids ?? [],
        config: input.config ?? {},
        agent_quota: input.agent_quota ?? 0,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
    }

    const { data, error } = await this.client
      .from('shops')
      .insert({
        name: input.name,
        platform: input.platform,
        shop_url: input.shop_url || null,
        logo_url: input.logo_url || null,
        total_accounts: input.total_accounts ?? 0,
        used_accounts: 0,
        status: 'active',
        contact_name: input.contact_name || null,
        contact_phone: input.contact_phone || null,
        remark: input.remark || null,
        knowledge_ids: input.knowledge_ids ?? [],
        config: input.config ?? {},
        agent_quota: input.agent_quota ?? 0,
      })
      .select('*')
      .single();

    if (error) throw new RepositoryError('create shop', error.message, error.code);
    return data as ShopRow;
  }

  async update(id: string, input: UpdateShopInput): Promise<ShopRow> {
    if (isDemoMode()) {
      throw new RepositoryError('update shop', 'Demo mode does not support updates');
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.platform !== undefined) updateData.platform = input.platform;
    if (input.shop_url !== undefined) updateData.shop_url = input.shop_url;
    if (input.logo_url !== undefined) updateData.logo_url = input.logo_url;
    if (input.total_accounts !== undefined) updateData.total_accounts = input.total_accounts;
    if (input.used_accounts !== undefined) updateData.used_accounts = input.used_accounts;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.contact_name !== undefined) updateData.contact_name = input.contact_name;
    if (input.contact_phone !== undefined) updateData.contact_phone = input.contact_phone;
    if (input.remark !== undefined) updateData.remark = input.remark;
    if (input.knowledge_ids !== undefined) updateData.knowledge_ids = input.knowledge_ids;
    if (input.config !== undefined) updateData.config = input.config;
    if (input.agent_quota !== undefined) updateData.agent_quota = input.agent_quota;

    const { data, error } = await this.client
      .from('shops')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new RepositoryError('update shop', error.message, error.code);
    return data as ShopRow;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;

    const { error } = await this.client
      .from('shops')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete shop', error.message, error.code);
  }

  async getStats(): Promise<{ total: number; totalAccounts: number; usedAccounts: number; availableAccounts: number }> {
    if (isDemoMode()) {
      return { total: 0, totalAccounts: 0, usedAccounts: 0, availableAccounts: 0 };
    }

    const { data, error } = await this.client
      .from('shops')
      .select('total_accounts, used_accounts')
      .eq('status', 'active');

    if (error) throw new RepositoryError('get shop stats', error.message, error.code);

    const rows = data ?? [];
    return {
      total: rows.length,
      totalAccounts: rows.reduce((sum: number, r: { total_accounts: number }) => sum + r.total_accounts, 0),
      usedAccounts: rows.reduce((sum: number, r: { used_accounts: number }) => sum + r.used_accounts, 0),
      availableAccounts: rows.reduce(
        (sum: number, r: { total_accounts: number; used_accounts: number }) => sum + (r.total_accounts - r.used_accounts),
        0,
      ),
    };
  }
}
