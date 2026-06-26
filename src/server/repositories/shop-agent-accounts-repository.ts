import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import type { ShopAgentAccountRow } from './types';

export interface CreateShopAgentAccountInput {
  shop_id: string;
  account_name: string;
  encrypted_password: string;
  platform?: string | null;
}

export class ShopAgentAccountsRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  async listByShopId(shopId: string): Promise<ShopAgentAccountRow[]> {
    if (isDemoMode()) return [];

    const { data, error } = await this.client
      .from('shop_agent_accounts')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: true });

    if (error) throw new RepositoryError('DB_QUERY_FAILED', error.message);
    return (data ?? []) as ShopAgentAccountRow[];
  }

  async countByShopId(shopId: string): Promise<{ total: number; active: number }> {
    if (isDemoMode()) return { total: 0, active: 0 };

    const [{ count: total }, { count: active }] = await Promise.all([
      this.client.from('shop_agent_accounts').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
      this.client.from('shop_agent_accounts').select('*', { count: 'exact', head: true }).eq('shop_id', shopId).eq('status', 'active'),
    ]);

    return { total: total ?? 0, active: active ?? 0 };
  }

  async create(input: CreateShopAgentAccountInput): Promise<ShopAgentAccountRow> {
    if (isDemoMode()) {
      const demo: ShopAgentAccountRow = {
        id: crypto.randomUUID(),
        ...input,
        status: 'active',
        created_at: new Date().toISOString(),
      };
      // Demo mode: store in memory for session
      return demo;
    }

    const { data, error } = await this.client
      .from('shop_agent_accounts')
      .insert({
        shop_id: input.shop_id,
        account_name: input.account_name,
        encrypted_password: input.encrypted_password,
        platform: input.platform || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw new RepositoryError('DB_INSERT_FAILED', error.message);
    return data as ShopAgentAccountRow;
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;

    const { error } = await this.client
      .from('shop_agent_accounts')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('DB_DELETE_FAILED', error.message);
  }
}
