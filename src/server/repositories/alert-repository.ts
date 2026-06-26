import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { Alert } from '@/lib/types';
import { RepositoryError } from './repository-error';
import { DEMO_ALERTS } from './demo-data/demo-alerts';

export interface AlertFilters {
  resolved?: boolean | null;
  severity?: string | null;
  limit?: number;
}

export interface CreateAlertInput {
  conversation_id?: string | null;
  type: string;
  severity?: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface AlertStatsRow {
  severity: string;
  is_resolved: boolean;
}

export class AlertRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(filters: AlertFilters): Promise<Alert[]> {
    if (isDemoMode()) {
      let filtered = DEMO_ALERTS;
      if (filters.resolved !== null && filters.resolved !== undefined) filtered = filtered.filter(a => a.is_resolved === filters.resolved);
      if (filters.severity) filtered = filtered.filter(a => a.severity === filters.severity);
      return filtered.slice(0, filters.limit ?? 20);
    }
    let query = this.client
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(filters.limit ?? 20);

    if (filters.resolved !== null && filters.resolved !== undefined) {
      query = query.eq('is_resolved', filters.resolved);
    }
    if (filters.severity) {
      query = query.eq('severity', filters.severity);
    }

    const { data, error } = await query;
    if (error) throw new RepositoryError('list alerts', error.message, error.code);
    return (data ?? []) as Alert[];
  }

  async listStatsRows(): Promise<AlertStatsRow[]> {
    if (isDemoMode()) return [
      { severity: 'warning', is_resolved: false },
      { severity: 'critical', is_resolved: false },
      { severity: 'info', is_resolved: true },
    ];
    const { data, error } = await this.client.from('alerts').select('severity, is_resolved');
    if (error) throw new RepositoryError('list alert stats', error.message, error.code);
    return (data ?? []) as AlertStatsRow[];
  }

  async findRecentUnresolved(
    conversationId: string,
    type: string,
    sinceIso: string,
  ): Promise<{ id: string } | null> {
    if (isDemoMode()) return null;
    const { data, error } = await this.client
      .from('alerts')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('type', type)
      .eq('is_resolved', false)
      .gte('created_at', sinceIso)
      .maybeSingle();

    if (error) throw new RepositoryError('find recent alert', error.message, error.code);
    return data as { id: string } | null;
  }

  async create(input: CreateAlertInput): Promise<Alert> {
    if (isDemoMode()) return { id: 'demo-alert-new', conversation_id: input.conversation_id, type: input.type, severity: input.severity ?? 'warning', message: input.message, is_resolved: false, metadata: input.metadata ?? null, created_at: new Date().toISOString() } as Alert;
    const { data, error } = await this.client
      .from('alerts')
      .insert({
        conversation_id: input.conversation_id,
        type: input.type,
        severity: input.severity ?? 'warning',
        message: input.message,
        metadata: input.metadata ?? null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create alert', error.message, error.code);
    return data as Alert;
  }

  async resolve(id: string): Promise<void> {
    if (isDemoMode()) return;
    const { error } = await this.client
      .from('alerts')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw new RepositoryError('resolve alert', error.message, error.code);
  }
}
