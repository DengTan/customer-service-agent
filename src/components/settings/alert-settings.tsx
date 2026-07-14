'use client';

import { AlertTriangle } from 'lucide-react';

interface AlertSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function AlertSettings({ settings, onSettingsChange }: AlertSettingsProps) {
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
                <span className="text-xs font-medium text-foreground">{(parseFloat(settings.alert_confidence_threshold || '0.4') * 100).toFixed(0)}%</span>
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
                <span className="text-xs font-medium text-foreground">{(parseFloat(settings.alert_confidence_critical_threshold || '0.2') * 100).toFixed(0)}%</span>
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
              <input
                type="number"
                value={settings.alert_high_rounds_threshold || '10'}
                onChange={(e) => onSettingsChange((prev) => ({ ...prev, alert_high_rounds_threshold: e.target.value }))}
                min="3"
                max="50"
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Critical（轮次）</label>
              <input
                type="number"
                value={settings.alert_high_rounds_critical_threshold || '15'}
                onChange={(e) => onSettingsChange((prev) => ({ ...prev, alert_high_rounds_critical_threshold: e.target.value }))}
                min="5"
                max="100"
                className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>

        {/* Auto Handoff */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">自动转人工条件</label>
          <p className="text-xs text-muted-foreground mb-3">当置信度低于告警阈值且对话轮次超过以下值时，自动转接人工客服</p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">最小轮次</label>
            <input
              type="number"
              value={settings.alert_auto_handoff_rounds || '6'}
              onChange={(e) => onSettingsChange((prev) => ({ ...prev, alert_auto_handoff_rounds: e.target.value }))}
              min="1"
              max="30"
              className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
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
            <li>置信度 &lt; {(parseFloat(settings.alert_confidence_threshold || '0.4') * 100).toFixed(0)}% → Warning 告警</li>
            <li>置信度 &lt; {(parseFloat(settings.alert_confidence_critical_threshold || '0.2') * 100).toFixed(0)}% → Critical 告警</li>
            <li>消息数 &gt; {settings.alert_high_rounds_threshold || '10'} → Warning 告警</li>
            <li>消息数 &gt; {settings.alert_high_rounds_critical_threshold || '15'} → Critical 告警</li>
            <li>置信度低于阈值 且 消息数 &gt; {settings.alert_auto_handoff_rounds || '6'} → 自动转人工</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
