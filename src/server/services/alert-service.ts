import type { Alert } from '@/lib/types';
import {
  AlertRepository,
  type AlertFilters,
  type CreateAlertInput,
} from '@/server/repositories/alert-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { ConversationService } from './conversation-service';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

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
    private readonly conversations = new ConversationService(),
    private readonly settingsRepo = new SettingsRepository(),
  ) {}

  async listAlerts(filters: AlertFilters): Promise<{ alerts: Alert[]; stats: AlertStats }> {
    try {
      const [alerts, statsRows] = await Promise.all([
        this.alerts.list(filters),
        this.alerts.listStatsRows(),
      ]);

      const stats = {
        total: statsRows.length,
        unresolved: statsRows.filter((alert) => !alert.is_resolved).length,
        critical: statsRows.filter(
          (alert) => alert.severity === 'critical' && !alert.is_resolved,
        ).length,
        warning: statsRows.filter(
          (alert) => alert.severity === 'warning' && !alert.is_resolved,
        ).length,
      };

      return { alerts, stats };
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch alerts');
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

  async resolveAlert(id: string | null): Promise<void> {
    if (!id) {
      throw new ServiceError('Alert id is required', { status: 400, code: 'VALIDATION_ERROR' });
    }

    try {
      await this.alerts.resolve(id);
    } catch (error) {
      throw toServiceError(error, 'Failed to resolve alert');
    }
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
      const conversation = await this.conversations.ensureCanReceiveAiMessage(conversationId);
      if (conversation.status === 'active') {
        await this.conversations.markHandoff(
          conversationId,
          `AI confidence is low (${(confidence * 100).toFixed(0)}%) after ${messageCount} messages.`,
        );
        await this.conversations.insertMessage({
          conversation_id: conversationId,
          role: 'system',
          content: 'AI may not be able to solve this issue effectively. Connecting you to a human agent.',
        });
      }
    }
  }

  private async findRecentUnresolved(conversationId: string, type: string): Promise<{ id: string } | null> {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    return this.alerts.findRecentUnresolved(conversationId, type, thirtyMinAgo);
  }
}
