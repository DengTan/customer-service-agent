import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';

export interface ScheduleFilters {
  date?: string | null;
  user_id?: string | null;
  skill_group_id?: string | null;
}

export interface ScheduleItem {
  user_id: string;
  skill_group_id: string;
  date: string;
  shift: string;
}

export class ScheduleRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: ScheduleFilters = {}): Promise<unknown[]> {
    if (isDemoMode()) {
      const today = new Date().toISOString().split('T')[0];
      return [
        { id: 'demo-sch-1', user_id: 'demo-user-2', skill_group_id: 'demo-sg-1', date: today, shift: 'morning', user_name: '李小红', group_name: '售前咨询组' },
        { id: 'demo-sch-2', user_id: 'demo-user-3', skill_group_id: 'demo-sg-2', date: today, shift: 'afternoon', user_name: '王大明', group_name: '售后组' },
      ];
    }
    let query = this.client
      .from('schedules')
      .select('*, user:users!schedules_user_id_fkey(name), group:skill_groups!schedules_skill_group_id_fkey(name)')
      .order('date', { ascending: true });

    if (filters.date) query = query.eq('date', filters.date);
    if (filters.user_id) query = query.eq('user_id', filters.user_id);
    if (filters.skill_group_id) query = query.eq('skill_group_id', filters.skill_group_id);

    const { data, error } = await query;
    if (error) throw new RepositoryError('list schedules', error.message, error.code);

    return (data || []).map((item: Record<string, unknown>) => ({
      ...item,
      user_name: (item.user as Record<string, string>)?.name || null,
      group_name: (item.group as Record<string, string>)?.name || null,
    }));
  }

  async upsert(items: ScheduleItem[]): Promise<unknown[]> {
    if (isDemoMode()) return items;
    const { data, error } = await this.client
      .from('schedules')
      .upsert(items, { onConflict: 'user_id,date,shift' })
      .select();

    if (error) throw new RepositoryError('upsert schedules', error.message, error.code);
    return data ?? [];
  }

  async delete(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('schedules')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete schedule', error.message, error.code);
  }
}
