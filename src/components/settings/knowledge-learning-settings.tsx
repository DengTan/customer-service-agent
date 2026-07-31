'use client';

import { NumberInput } from '@/components/common/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCallback, useRef } from 'react';

interface KnowledgeLearningSettingsProps {
  settings: Record<string, string>;
  onSettingsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onValidationChange?: (isValid: boolean, invalidKey: string | null) => void;
}

export function KnowledgeLearningSettings({
  settings,
  onSettingsChange,
  onValidationChange,
}: KnowledgeLearningSettingsProps) {
  const fieldValidityRef = useRef<Record<string, boolean>>({});
  const reportValidity = useCallback(() => {
    if (!onValidationChange) return;
    const invalidKey =
      Object.entries(fieldValidityRef.current).find(([, v]) => !v)?.[0] ?? null;
    onValidationChange(invalidKey === null, invalidKey);
  }, [onValidationChange]);
  const trackField = useCallback(
    (key: string) => (isValid: boolean) => {
      if (fieldValidityRef.current[key] === isValid) return;
      fieldValidityRef.current[key] = isValid;
      reportValidity();
    },
    [reportValidity],
  );
  const trackConfidence = trackField('knowledge_learning_confidence_threshold');

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
          <NumberInput
            id="knowledge-learning-confidence"
            value={settings.knowledge_learning_confidence_threshold ?? '0.85'}
            onChange={(v) =>
              onSettingsChange((prev) => ({ ...prev, knowledge_learning_confidence_threshold: v }))
            }
            onValidationChange={trackConfidence}
            min={0}
            max={1}
            step={0.05}
            fallback="0.85"
          />
          <p className="text-xs text-muted-foreground mt-1">（范围: 0 - 1）</p>
        </div>

        {/* Scan Interval */}
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-1 block">扫描间隔</label>
          <p className="text-xs text-muted-foreground mb-3">
            避免短时间内重复扫描同一对话
          </p>
          <Select
            value={settings.knowledge_learning_scan_interval_hours ?? '24'}
            onValueChange={(value) =>
              onSettingsChange((prev) => ({ ...prev, knowledge_learning_scan_interval_hours: value }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6 小时</SelectItem>
              <SelectItem value="12">12 小时</SelectItem>
              <SelectItem value="24">24 小时</SelectItem>
              <SelectItem value="168">每周（168 小时）</SelectItem>
            </SelectContent>
          </Select>
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
            <Switch
              checked={settings.knowledge_learning_auto_scan_enabled === 'true'}
              onCheckedChange={(checked) =>
                onSettingsChange((prev) => ({
                  ...prev,
                  knowledge_learning_auto_scan_enabled: String(checked),
                }))
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
