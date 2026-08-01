import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { Alert } from '@/lib/types';
import { RepositoryError } from './repository-error';
import { DEMO_ALERTS } from './demo-data/demo-alerts';
import { logger } from '@/lib/logger';

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

/**
 * Shape returned by the `alerts_aggregate_stats` RPC.
 *
 * The dashboard only consumes `total / unresolved / critical / warning`, but
 * the RPC also pre-computes `open / resolved / dismissed` and three
 * `by_*` breakdowns so future UI cards can read them without a follow-up
 * full-table scan.
 */
export interface AlertAggregateStats {
  total: number;
  unresolved: number;
  critical: number;
  warning: number;
  open: number;
  resolved: number;
  dismissed: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
}

/**
 * Patch for `AlertRepository.update()`. `metadata` is merged (not replaced) so
 * callers can write operator audit keys without clobbering existing structured
 * fields; `metadataMerge` lets callers add audit keys without sending the full
 * metadata object.
 */
export interface AlertUpdatePatch {
  status?: 'open' | 'resolved' | 'dismissed';
  is_resolved?: boolean;
  resolved_at?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Keys to merge into the existing metadata object. */
  metadataMerge?: Record<string, unknown>;
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

  /**
   * @deprecated Prefer `getAggregateStats()` — this loads every row of
   * `alerts` into memory and is kept only as a fallback when the RPC is
   * unavailable (e.g. RLS denies the SECURITY DEFINER call, or the function
   * has not yet been deployed). The service layer in `alert-service.ts`
   * calls it only after a `getAggregateStats` failure.
   */
  async listStatsRows(): Promise<AlertStatsRow[]> {
    if (isDemoMode()) return this.demoStatsRows();
    const { data, error } = await this.client.from('alerts').select('severity, is_resolved');
    if (error) throw new RepositoryError('list alert stats', error.message, error.code);
    return (data ?? []) as AlertStatsRow[];
  }

  /**
   * Aggregate alert counts via the `alerts_aggregate_stats` RPC.
   *
   * Replaces the previous full-table `SELECT severity, is_resolved` with a
   * single round-trip that pushes the FILTER aggregates into Postgres.
   * Returns the same `{ total, unresolved, critical, warning }` tuple the
   * caller used to build in memory, plus `open / resolved / dismissed` and
   * three `by_*` breakdowns.
   */
  async getAggregateStats(): Promise<AlertAggregateStats> {
    if (isDemoMode()) {
      const rows = this.demoStatsRows();
      return this.aggregateFromRows(rows);
    }
    const { data, error } = await this.client.rpc('alerts_aggregate_stats');
    if (error) {
      logger.error('alerts_aggregate_stats RPC failed', { error: error.message, code: error.code });
      throw new RepositoryError('aggregate alert stats', error.message, error.code);
    }
    return data as AlertAggregateStats;
  }

  private demoStatsRows(): AlertStatsRow[] {
    return [
      { severity: 'warning', is_resolved: false },
      { severity: 'critical', is_resolved: false },
      { severity: 'info', is_resolved: true },
    ];
  }

  private aggregateFromRows(rows: AlertStatsRow[]): AlertAggregateStats {
    const total = rows.length;
    const unresolved = rows.filter((r) => !r.is_resolved).length;
    const critical = rows.filter((r) => r.severity === 'critical' && !r.is_resolved).length;
    const warning = rows.filter((r) => r.severity === 'warning' && !r.is_resolved).length;
    return {
      total,
      unresolved,
      critical,
      warning,
      // The legacy fallback only knows about severity + is_resolved, so the
      // status / by_* breakdowns collapse to zero in demo mode. This matches
      // the previous demo behaviour (the JS code never surfaced these counts
      // either) and keeps the demo contract identical.
      open: 0,
      resolved: 0,
      dismissed: 0,
      by_type: {},
      by_severity: {},
      by_status: {},
    };
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
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new RepositoryError('find recent alert', error.message, error.code);
    return data as { id: string } | null;
  }

  /**
   * Batch query recent unresolved alerts by types within a time window.
   * Used by SLA checker to avoid N+1 queries.
   */
  async findRecentUnresolvedBatch(
    types: string[],
    sinceIso: string,
  ): Promise<Array<{ conversation_id: string; type: string }>> {
    if (isDemoMode()) return [];
    const { data, error } = await this.client
      .from('alerts')
      .select('conversation_id, type')
      .in('type', types)
      .eq('is_resolved', false)
      .gte('created_at', sinceIso);

    if (error) throw new RepositoryError('find recent alerts batch', error.message, error.code);
    return (data ?? []) as Array<{ conversation_id: string; type: string }>;
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

  async findById(id: string): Promise<Alert | null> {
    if (isDemoMode()) {
      const match = DEMO_ALERTS.find((a) => a.id === id);
      return (match ?? null) as Alert | null;
    }
    const { data, error } = await this.client
      .from('alerts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new RepositoryError('find alert by id', error.message, error.code);
    return (data ?? null) as Alert | null;
  }

  /**
   * Partial update for an alert. `metadata` is merged with any existing
   * metadata so callers can add audit keys (e.g. `resolved_by`,
   * `dismissed_at`) without clobbering the existing structured fields. Use
   * `metadataMerge` to layer in new keys, or pass `metadata` to replace the
   * whole JSONB column.
   *
   * Implementation does `findById → mutate → write back the full row` so we
   * avoid raw SQL fragments and keep the JSON shape easy to reason about.
   */
  async update(id: string, patch: AlertUpdatePatch): Promise<void> {
    if (isDemoMode()) return;

    const updatePayload: Record<string, unknown> = {};
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.is_resolved !== undefined) updatePayload.is_resolved = patch.is_resolved;
    if (patch.resolved_at !== undefined) updatePayload.resolved_at = patch.resolved_at;

    const hasMetadataPatch =
      patch.metadata !== undefined || patch.metadataMerge !== undefined;
    if (hasMetadataPatch) {
      const current = await this.findById(id);
      const baseMetadata =
        ((current?.metadata ?? {}) as Record<string, unknown>);
      const merged: Record<string, unknown> = {
        ...baseMetadata,
        ...(patch.metadata ?? {}),
        ...(patch.metadataMerge ?? {}),
      };
      updatePayload.metadata = merged;
    }

    if (Object.keys(updatePayload).length === 0) return;

    const { error } = await this.client
      .from('alerts')
      .update(updatePayload as never)
      .eq('id', id);

    if (error) throw new RepositoryError('update alert', error.message, error.code);
  }
}
