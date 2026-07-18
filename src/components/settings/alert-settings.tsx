'use client';

import { AlertTriangle } from 'lucide-react';
import { NumberInput } from '@/components/common/number-input';
import { useCallback, useEffect, useRef } from 'react';

interface AlertSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /**
   * false ⇒ at least one numeric field is invalid OR the cross-field
   * "critical > warning" constraint is violated. Parent disables save.
   */
  onValidationChange?: (isValid: boolean, invalidKey: string | null) => void;
}

/** Parse a threshold setting to a number, falling back to the provided default. */
function parseThreshold(settings: Record<string, string>, key: string, fallback: string): number {
  return parseFloat(settings[key] || fallback);
}

export function AlertSettings({ settings, onSettingsChange, onValidationChange }: AlertSettingsProps) {
  // Aggregate per-field + cross-field validity. The cross-field rule
  // (critical > warning) is enforced here in the UI to mirror the
  // server-side INVALID_THRESHOLD_RELATION check in SettingsService.
  // Critical ≤ Warning means the more-severe alert fires no later than
  // the less-severe one, which makes no operational sense.
  const fieldValidityRef = useRef<Record<string, boolean>>({});
  const crossFieldErrorRef = useRef<string | null>(null);
  // Hold the latest settings in a ref so the closures below don't capture
  // stale snapshots. Without this, `trackField` would always read the
  // settings from the moment it was first memoised.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reportValidity = useCallback(() => {
    if (!onValidationChange) return;
    if (crossFieldErrorRef.current) {
      onValidationChange(false, crossFieldErrorRef.current);
      return;
    }
    const invalidKey =
      Object.entries(fieldValidityRef.current).find(([, v]) => !v)?.[0] ?? null;
    onValidationChange(invalidKey === null, invalidKey);
  }, [onValidationChange]);

  const recomputeCrossFieldError = useCallback(() => {
    const s = settingsRef.current;

    // Rule 1: high-rounds critical > warning. Mirrors the server-side
    // INVALID_THRESHOLD_RELATION check in SettingsService.validateSettings
    // (see server/services/settings-service.ts).
    const roundsWarning = parseInt(s.alert_high_rounds_threshold || '', 10);
    const roundsCritical = parseInt(s.alert_high_rounds_critical_threshold || '', 10);
    let roundsErr: string | null = null;
    if (Number.isFinite(roundsWarning) && Number.isFinite(roundsCritical)) {
      if (roundsCritical <= roundsWarning) {
        roundsErr = 'alert_high_rounds_critical_threshold';
      }
    }

    // Rule 2: confidence critical < warning (smaller score ⇒ worse). Both
    // fields are range sliders, so they always parse to a finite float
    // within their respective [min, max] — we only need to verify the
    // relationship itself.
    const confWarning = parseFloat(s.alert_confidence_threshold || '');
    const confCritical = parseFloat(s.alert_confidence_critical_threshold || '');
    let confErr: string | null = null;
    if (Number.isFinite(confWarning) && Number.isFinite(confCritical)) {
      if (confCritical >= confWarning) {
        confErr = 'alert_confidence_critical_threshold';
      }
    }

    // Report the first failing rule. Rounds takes priority because it's
    // more directly user-edited (NumberInput); confidence is range so
    // the violation is rarer and lower-stakes to surface.
    crossFieldErrorRef.current = roundsErr ?? confErr;
    reportValidity();
  }, [reportValidity]);

  const trackField = useCallback(
    (key: string) => (isValid: boolean) => {
      if (fieldValidityRef.current[key] === isValid) return;
      fieldValidityRef.current[key] = isValid;
      recomputeCrossFieldError();
    },
    [recomputeCrossFieldError],
  );

  // Recompute the cross-field rule whenever any of the four bound
  // settings changes (e.g. user edits a value, or the parent resets it).
  // Doing this in a useEffect guarantees we read the post-setState
  // settings (via settingsRef) — earlier versions tried to call
  // recomputeCrossFieldError inside the onChange handler via
  // queueMicrotask, but that ran before React re-rendered, so the ref
  // still held the pre-edit value. Subscribing to the keys we care
  // about is the correct pattern.
  useEffect(() => {
    recomputeCrossFieldError();
  }, [
    settings.alert_high_rounds_threshold,
    settings.alert_high_rounds_critical_threshold,
    settings.alert_confidence_threshold,
    settings.alert_confidence_critical_threshold,
    recomputeCrossFieldError,
  ]);

  const trackWarningRounds = trackField('alert_high_rounds_threshold');
  const trackCriticalRounds = trackField('alert_high_rounds_critical_threshold');
  const trackAutoHandoffRounds = trackField('alert_auto_handoff_rounds');

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">异常告警条件</h2>
      <p className="text-xs text-muted-foreground mb-4">配置异常检测阈值，触发告警和自动转人工的条件</p>
      <div className="space-y-6">
        {/* Confidence Thresholds */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">低置信度告警阈值</label>
          <p className="text-xs text-muted-foreground mb-3">AI 回复置信度低于此值时产生告警</p>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">告警阈值（Warning）</span>
                <span className="text-xs font-medium text-foreground">{(parseThreshold(settings, 'alert_confidence_threshold', '0.4') * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={settings.alert_confidence_threshold || '0.4'}
                onChange={(e) => onSettingsChange((prev) => ({ ...prev, alert_confidence_threshold: e.target.value }))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                <span>10%</span>
                <span>50%</span>
                <span>90%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">严重告警阈值（Critical）</span>
                <span className="text-xs font-medium text-foreground">{(parseThreshold(settings, 'alert_confidence_critical_threshold', '0.2') * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={settings.alert_confidence_critical_threshold || '0.2'}
                onChange={(e) => onSettingsChange((prev) => ({ ...prev, alert_confidence_critical_threshold: e.target.value }))}
                className="w-full accent-destructive"
              />
              <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                <span>5%</span>
                <span>25%</span>
                <span>50%</span>
              </div>
              {crossFieldErrorRef.current === 'alert_confidence_critical_threshold' && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  严重告警置信度阈值必须小于告警阈值
                </p>
              )}
            </div>
          </div>
        </div>

        {/* High Rounds Thresholds */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">高轮次告警阈值</label>
          <p className="text-xs text-muted-foreground mb-3">对话消息数超过阈值时产生告警</p>
          <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Warning（轮次）</label>
            <NumberInput
              id="alert-warning-rounds"
              value={settings.alert_high_rounds_threshold || '10'}
              onChange={(v) => onSettingsChange((prev) => ({ ...prev, alert_high_rounds_threshold: v }))}
              onValidationChange={trackWarningRounds}
              min={1}
              max={1_000}
              step={1}
              fallback="10"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Critical（轮次）</label>
            <NumberInput
              id="alert-critical-rounds"
              value={settings.alert_high_rounds_critical_threshold || '15'}
              onChange={(v) => onSettingsChange((prev) => ({ ...prev, alert_high_rounds_critical_threshold: v }))}
              onValidationChange={trackCriticalRounds}
              min={1}
              max={1_000}
              step={1}
              fallback="15"
            />
            {crossFieldErrorRef.current === 'alert_high_rounds_critical_threshold' && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                严重告警轮次必须大于告警轮次
              </p>
            )}
          </div>
        </div>
        </div>

        {/* Auto Handoff */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">自动转人工条件</label>
          <p className="text-xs text-muted-foreground mb-3">当置信度低于告警阈值且对话轮次超过以下值时，自动转接人工客服</p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">最小轮次</label>
            <NumberInput
              id="alert-auto-handoff-rounds"
              value={settings.alert_auto_handoff_rounds || '6'}
              onChange={(v) => onSettingsChange((prev) => ({ ...prev, alert_auto_handoff_rounds: v }))}
              onValidationChange={trackAutoHandoffRounds}
              min={1}
              max={1_000}
              step={1}
              fallback="6"
            />
          </div>
        </div>

        {/* Current Rules Summary */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">当前生效规则摘要</span>
          </div>
          <ul className="text-xs text-amber-700/80 dark:text-amber-400/80 space-y-1">
            <li>置信度 &lt; {(parseThreshold(settings, 'alert_confidence_threshold', '0.4') * 100).toFixed(0)}% → Warning 告警</li>
            <li>置信度 &lt; {(parseThreshold(settings, 'alert_confidence_critical_threshold', '0.2') * 100).toFixed(0)}% → Critical 告警</li>
            <li>消息数 &gt; {settings.alert_high_rounds_threshold || '10'} → Warning 告警</li>
            <li>消息数 &gt; {settings.alert_high_rounds_critical_threshold || '15'} → Critical 告警</li>
            <li>置信度低于阈值 且 消息数 &gt; {settings.alert_auto_handoff_rounds || '6'} → 自动转人工</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
