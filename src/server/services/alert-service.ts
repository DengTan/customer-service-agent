import type { Alert } from '@/lib/types';
import { logger } from '@/lib/logger';
import {
  AlertRepository,
  type AlertFilters,
  type CreateAlertInput,
} from '@/server/repositories/alert-repository';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { isDemoMode } from '@/storage/database/supabase-client';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import {
  alertStateMachine,
  type AlertState,
  type AlertTransitionPayload,
} from '@/lib/alert-state-machine';
import {
  applyTransition,
  GuardRejectionError,
  UnknownTransitionError,
} from '@/lib/state-machine';
import type { HandoffService } from './handoff-service';

/** Audit context for state-machine operations on an alert. */
export interface AlertOperator {
  operatorId: string | null;
  operatorRole: string | null;
}

// Alert type constants
export const ALERT_TYPE_LOW_CONFIDENCE = 'low_confidence';
export const ALERT_TYPE_HIGH_ROUNDS = 'high_rounds';
export const ALERT_TYPE_QUALITY_CHECK_FAILED = 'quality_check_failed';
export const ALERT_TYPE_SATISFACTION_BELOW = 'satisfaction_below';

// Default dedup window: 30 minutes (kept as fallback for tests / when settings
// table is unreachable). The runtime value is read from `alert_dedup_window_minutes`
// via getAlertDedupWindowMs() below.
const DEFAULT_ALERT_DEDUP_WINDOW_MS = 30 * 60 * 1000;
const ALERT_DEDUP_CACHE_TTL_MS = 30_000;
const ALERT_DEDUP_WINDOW_MINUTES_MIN = 1;
const ALERT_DEDUP_WINDOW_MINUTES_MAX = 1440;

let cachedDedupWindowMs: number | null = null;
let cachedDedupWindowAt = 0;
const alertDedupSettingsRepo = new SettingsRepository();

/**
 * Read the alert dedup window (ms) from settings, with a 30s TTL cache.
 * Mirrors `getSearchSettings()` in `knowledge-search-service.ts`.
 *
 * Settings key: `alert_dedup_window_minutes` (integer minutes in
 * [1, 1440]). Falls back to DEFAULT_ALERT_DEDUP_WINDOW_MS (30 minutes)
 * when the key is unset, unparseable, out of range, or the read fails.
 *
 * The cache invalidation function `invalidateAlertDedupCache()` is exported
 * so the settings PUT handler can drop the cache immediately after a write.
 */
async function getAlertDedupWindowMs(): Promise<number> {
  const now = Date.now();
  if (cachedDedupWindowMs !== null && now - cachedDedupWindowAt < ALERT_DEDUP_CACHE_TTL_MS) {
    return cachedDedupWindowMs;
  }

  let valueMs = DEFAULT_ALERT_DEDUP_WINDOW_MS;
  if (!isDemoMode()) {
    try {
      const raw = await alertDedupSettingsRepo.get('alert_dedup_window_minutes');
      if (raw !== null) {
        const minutes = Number.parseInt(raw, 10);
        if (
          Number.isInteger(minutes) &&
          minutes >= ALERT_DEDUP_WINDOW_MINUTES_MIN &&
          minutes <= ALERT_DEDUP_WINDOW_MINUTES_MAX
        ) {
          valueMs = minutes * 60 * 1000;
        }
      }
    } catch (err) {
      // Settings table read failure must never break alert dedup; keep default.
      logger.agent.warn('[AlertService] Failed to read alert_dedup_window_minutes, using default', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  cachedDedupWindowMs = valueMs;
  cachedDedupWindowAt = now;
  return valueMs;
}

/**
 * Test/diagnostic helper: drop the cached dedup window so the next call
 * re-reads the settings table. Called by PUT /api/settings after a write.
 */
export function invalidateAlertDedupCache(): void {
  cachedDedupWindowMs = null;
  cachedDedupWindowAt = 0;
}

// Default thresholds (used when settings are not available)
export const DEFAULT_ALERT_SETTINGS = {
  confidenceThreshold: 0.4,
  confidenceCriticalThreshold: 0.2,
  highRoundsThreshold: 10,
  highRoundsCriticalThreshold: 15,
  autoHandoffRounds: 6,
} as const;

// Keep the constant for backward compatibility with other modules that import it
export const CONFIDENCE_HANDOFF_THRESHOLD = DEFAULT_ALERT_SETTINGS.confidenceThreshold;

export interface AlertSettings {
  confidenceThreshold: number;
  confidenceCriticalThreshold: number;
  highRoundsThreshold: number;
  highRoundsCriticalThreshold: number;
  autoHandoffRounds: number;
}

export interface AlertStats {
  total: number;
  unresolved: number;
  critical: number;
  warning: number;
}

export class AlertService {
  constructor(
    private readonly alerts = new AlertRepository(),
    private readonly conversations = new ConversationRepository(),
    private readonly settingsRepo = new SettingsRepository(),
    private readonly handoffService: Pick<HandoffService, 'requestHandoff'> | null = null,
  ) {}

  async listAlerts(filters: AlertFilters): Promise<{ alerts: Alert[]; stats: AlertStats }> {
    try {
      // Aggregate stats come from the `alerts_aggregate_stats` RPC (single
      // round-trip with FILTER aggregates). On RPC failure we fall back to
      // the legacy in-memory aggregation so a missing function or transient
      // RLS denial does not break the dashboard.
      const [alerts, aggregate] = await Promise.all([
        this.alerts.list(filters),
        this.getStatsWithFallback(),
      ]);

      return {
        alerts,
        stats: {
          total: aggregate.total,
          unresolved: aggregate.unresolved,
          critical: aggregate.critical,
          warning: aggregate.warning,
        },
      };
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch alerts');
    }
  }

  private async getStatsWithFallback(): Promise<{
    total: number;
    unresolved: number;
    critical: number;
    warning: number;
  }> {
    try {
      const aggregate = await this.alerts.getAggregateStats();
      return {
        total: aggregate.total,
        unresolved: aggregate.unresolved,
        critical: aggregate.critical,
        warning: aggregate.warning,
      };
    } catch (error) {
      // RPC path is preferred, but the legacy in-memory scan stays as a
      // safety net so a freshly-deployed environment without the function
      // does not 500 the dashboard. listStatsRows() throws on a hard DB
      // failure which is propagated up by the outer try/catch.
      logger.warn('[AlertService] alerts_aggregate_stats RPC failed, falling back to listStatsRows', {
        error: error instanceof Error ? error.message : String(error),
      });
      const rows = await this.alerts.listStatsRows();
      return {
        total: rows.length,
        unresolved: rows.filter((r) => !r.is_resolved).length,
        critical: rows.filter((r) => r.severity === 'critical' && !r.is_resolved).length,
        warning: rows.filter((r) => r.severity === 'warning' && !r.is_resolved).length,
      };
    }
  }

  async createAlert(input: CreateAlertInput): Promise<{ alert: Alert | { id: string }; dedup?: boolean }> {
    if (!input.conversation_id || !input.type || !input.message) {
      throw new ServiceError('Required alert fields are missing', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const existing = await this.findRecentUnresolved(input.conversation_id, input.type);
      if (existing) return { alert: existing, dedup: true };

      const alert = await this.alerts.create(input);
      return { alert };
    } catch (error) {
      throw toServiceError(error, 'Failed to create alert');
    }
  }

  async resolveAlert(id: string | null, operator: AlertOperator = { operatorId: null, operatorRole: null }): Promise<void> {
    if (!id) {
      throw new ServiceError('Alert id is required', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const alert = await this.alerts.findById(id);
      if (!alert) {
        throw new ServiceError('告警不存在', { status: 404, code: 'NOT_FOUND' });
      }

      const currentState = this.deriveState(alert);
      await this.applyTransition(alert, currentState, { type: 'resolve' }, operator, async (next) => {
        await this.alerts.update(id, {
          status: next,
          is_resolved: true,
          resolved_at: new Date().toISOString(),
          metadataMerge: { resolved_by: operator.operatorId ?? null },
        });
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to resolve alert');
    }
  }

  /**
   * Dismiss an alert — operator acknowledges the alert as noise. The alert
   * stays un-resolved (no `is_resolved` flip) but its status moves to
   * `dismissed` and a `metadata.dismissed_by`/`dismissed_at` audit trail is
   * written. Dismissed alerts do not surface in the Dashboard's "unresolved"
   * filter but remain visible in the history drawer.
   */
  async dismissAlert(id: string, operator: AlertOperator): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少告警 ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const alert = await this.alerts.findById(id);
      if (!alert) {
        throw new ServiceError('告警不存在', { status: 404, code: 'NOT_FOUND' });
      }

      const currentState = this.deriveState(alert);
      await this.applyTransition(alert, currentState, { type: 'dismiss' }, operator, async (next) => {
        await this.alerts.update(id, {
          status: next,
          is_resolved: true,
          metadataMerge: {
            dismissed_by: operator.operatorId ?? null,
            dismissed_at: new Date().toISOString(),
          },
        });
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to dismiss alert');
    }
  }

  /**
   * Reopen a previously resolved alert. Only admins may do this — the state
   * machine guard enforces the role check. Reopen clears `resolved_at` and
   * flips `is_resolved` back to false.
   */
  async reopenAlert(id: string, operator: AlertOperator): Promise<void> {
    if (!id) {
      throw new ServiceError('缺少告警 ID', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      const alert = await this.alerts.findById(id);
      if (!alert) {
        throw new ServiceError('告警不存在', { status: 404, code: 'NOT_FOUND' });
      }

      const currentState = this.deriveState(alert);
      await this.applyTransition(alert, currentState, { type: 'reopen' }, operator, async (next) => {
        await this.alerts.update(id, {
          status: next,
          is_resolved: false,
          resolved_at: null,
          metadataMerge: { reopened_by: operator.operatorId ?? null },
        });
      });
    } catch (error) {
      throw toServiceError(error, 'Failed to reopen alert');
    }
  }

  /**
   * Derive the state-machine input state from a stored alert. Prefers the
   * explicit `status` column; falls back to `is_resolved` for legacy rows
   * that pre-date the migration so existing tests + backfill flows work
   * without a separate write path. Legacy "dismissed" rows are still
   * recognisable via the `metadata.dismissed_by` audit key.
   */
  private deriveState(alert: Alert): AlertState {
    const status = (alert as { status?: string }).status;
    if (status === 'resolved' || status === 'dismissed' || status === 'open') {
      return status;
    }
    const metadata = (alert.metadata ?? {}) as Record<string, unknown>;
    if (metadata.dismissed_by || metadata.dismissed_at) {
      return 'dismissed';
    }
    return alert.is_resolved ? 'resolved' : 'open';
  }

  /**
   * Shared helper: run a state-machine transition and translate its errors to
   * `ServiceError` with the right HTTP semantics. The `apply` callback runs
   * after the state machine accepts the transition and persists the side
   * effects the state requires.
   */
  private async applyTransition(
    alert: Alert,
    currentState: AlertState,
    event: { type: 'resolve' | 'dismiss' | 'reopen' },
    operator: AlertOperator,
    apply: (nextState: AlertState) => Promise<void>,
  ): Promise<void> {
    const payload: AlertTransitionPayload = {
      operatorId: operator.operatorId ?? null,
      operatorRole: operator.operatorRole ?? null,
    };

    let nextState: AlertState;
    try {
      const result = await applyTransition(
        alertStateMachine,
        currentState,
        event,
        { payload: payload as unknown as Record<string, unknown> },
      );
      nextState = result.nextState;
    } catch (err) {
      if (err instanceof UnknownTransitionError) {
        throw new ServiceError(
          `告警当前状态 "${currentState}" 不允许执行操作 "${event.type}"`,
          {
            status: 409,
            code: 'INVALID_STATE_TRANSITION',
          },
        );
      }
      if (err instanceof GuardRejectionError) {
        const status = err.reason.includes('admin') || err.reason.includes('管理员')
          ? 403
          : 409;
        throw new ServiceError(err.reason, {
          status,
          code: status === 403 ? 'FORBIDDEN' : 'INVALID_STATE_TRANSITION',
        });
      }
      throw err;
    }

    await apply(nextState);
  }

  /**
   * Read alert thresholds from settings, falling back to defaults on error.
   */
  private async getAlertSettings(): Promise<AlertSettings> {
    try {
      const rows = await this.settingsRepo.list();
      const map = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});

      return {
        confidenceThreshold: parseFloat(map.alert_confidence_threshold || '') || DEFAULT_ALERT_SETTINGS.confidenceThreshold,
        confidenceCriticalThreshold: parseFloat(map.alert_confidence_critical_threshold || '') || DEFAULT_ALERT_SETTINGS.confidenceCriticalThreshold,
        highRoundsThreshold: parseInt(map.alert_high_rounds_threshold || '', 10) || DEFAULT_ALERT_SETTINGS.highRoundsThreshold,
        highRoundsCriticalThreshold: parseInt(map.alert_high_rounds_critical_threshold || '', 10) || DEFAULT_ALERT_SETTINGS.highRoundsCriticalThreshold,
        autoHandoffRounds: parseInt(map.alert_auto_handoff_rounds || '', 10) || DEFAULT_ALERT_SETTINGS.autoHandoffRounds,
      };
    } catch {
      return { ...DEFAULT_ALERT_SETTINGS };
    }
  }

  async checkAndCreateConversationAlerts(
    conversationId: string,
    confidence: number | null,
    messageCount: number,
  ): Promise<void> {
    const config = await this.getAlertSettings();
    const alerts: CreateAlertInput[] = [];

    if (confidence !== null && confidence < config.confidenceThreshold) {
      alerts.push({
        conversation_id: conversationId,
        type: 'low_confidence',
        severity: confidence < config.confidenceCriticalThreshold ? 'critical' : 'warning',
        message: `AI confidence is low (${(confidence * 100).toFixed(0)}%). Human review may be needed.`,
        metadata: { confidence, threshold: config.confidenceThreshold },
      });
    }

    if (messageCount > config.highRoundsThreshold) {
      alerts.push({
        conversation_id: conversationId,
        type: 'high_rounds',
        severity: messageCount > config.highRoundsCriticalThreshold ? 'critical' : 'warning',
        message: `Conversation has reached ${messageCount} messages and may need human intervention.`,
        metadata: { messageCount },
      });
    }

    for (const alert of alerts) {
      await this.createAlert(alert);
    }

    if (confidence !== null && confidence < config.confidenceThreshold && messageCount > config.autoHandoffRounds) {
      // Use repository directly to avoid circular dependency with ConversationService
      const conversation = await this.conversations.findStatus(conversationId);
      if (conversation && conversation.status === 'active') {
        await this.conversations.update(conversationId, {
          status: 'handoff',
          handoff_reason: `AI confidence is low (${(confidence * 100).toFixed(0)}%) after ${messageCount} messages.`,
          updated_at: new Date().toISOString(),
        });
        await this.conversations.insertMessage({
          conversation_id: conversationId,
          role: 'system',
          content: 'AI may not be able to solve this issue effectively. Connecting you to a human agent.',
        });
      }
    }
  }

  private async findRecentUnresolved(conversationId: string, type: string): Promise<{ id: string } | null> {
    const windowMs = await getAlertDedupWindowMs();
    const sinceIso = new Date(Date.now() - windowMs).toISOString();
    return this.alerts.findRecentUnresolved(conversationId, type, sinceIso);
  }

  /**
   * Create an alert when a quality check fails.
   * @param conversationId - The conversation ID
   * @param ruleName - The name of the failed rule
   * @param ruleType - The type of the rule (e.g., negative_sentiment, keyword_violation)
   * @param detail - The detail message from the quality check
   */
  async createQualityFailedAlert(
    conversationId: string,
    ruleName: string,
    ruleType: string,
    detail?: string | null,
  ): Promise<void> {
    try {
      await this.createAlert({
        conversation_id: conversationId,
        type: ALERT_TYPE_QUALITY_CHECK_FAILED,
        severity: 'warning',
        message: `质检失败: ${ruleName}${detail ? ` - ${detail}` : ''}`,
        metadata: {
          rule_type: ruleType,
          rule_name: ruleName,
          detail: detail || null,
        },
      });
    } catch (error) {
      logger.warn('[AlertService] Failed to create quality failed alert', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        ruleName,
      });
    }
  }

  /**
   * Create an alert when satisfaction rating is below threshold.
   * @param conversationId - The conversation ID
   * @param rating - The actual rating value
   * @param threshold - The threshold that was not met
   */
  async createSatisfactionBelowAlert(
    conversationId: string,
    rating: number,
    threshold: number = 3,
  ): Promise<void> {
    try {
      await this.createAlert({
        conversation_id: conversationId,
        type: ALERT_TYPE_SATISFACTION_BELOW,
        severity: 'warning',
        message: `满意度评分过低: ${rating}星（阈值: ${threshold}星）`,
        metadata: {
          rating,
          threshold,
        },
      });
    } catch (error) {
      logger.warn('[AlertService] Failed to create satisfaction below alert', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        rating,
      });
    }
  }
}
