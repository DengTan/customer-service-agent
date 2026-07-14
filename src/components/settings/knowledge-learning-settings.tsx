'use client';

interface KnowledgeLearningSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function KnowledgeLearningSettings({ settings, onSettingsChange }: KnowledgeLearningSettingsProps) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">知识自学习</h2>
      <p className="text-xs text-muted-foreground mb-4">配置知识自学习功能的行为参数</p>
      <div className="space-y-6">
        {/* Confidence Threshold */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">置信度阈值</label>
          <p className="text-xs text-muted-foreground mb-3">
            AI 回复置信度高于此值时不提取为候选知识
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={settings.knowledge_learning_confidence_threshold ?? '0.85'}
              onChange={(e) => onSettingsChange((prev) => ({ ...prev, knowledge_learning_confidence_threshold: e.target.value }))}
              min="0"
              max="1"
              step="0.05"
              className="w-32 px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-xs text-muted-foreground">（范围: 0 - 1）</span>
          </div>
        </div>

        {/* Scan Interval */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">扫描间隔</label>
          <p className="text-xs text-muted-foreground mb-3">
            避免短时间内重复扫描同一对话
          </p>
          <select
            value={settings.knowledge_learning_scan_interval_hours ?? '24'}
            onChange={(e) => onSettingsChange((prev) => ({ ...prev, knowledge_learning_scan_interval_hours: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="6">6 小时</option>
            <option value="12">12 小时</option>
            <option value="24">24 小时</option>
            <option value="168">每周（168 小时）</option>
          </select>
        </div>

        {/* Auto Scan Toggle */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-medium text-foreground block">自动扫描</label>
              <p className="text-xs text-muted-foreground mt-0.5">
                定时执行扫描任务，自动提取候选知识
              </p>
            </div>
            <select
              value={settings.knowledge_learning_auto_scan_enabled ?? 'false'}
              onChange={(e) => onSettingsChange((prev) => ({ ...prev, knowledge_learning_auto_scan_enabled: e.target.value }))}
              className="px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
