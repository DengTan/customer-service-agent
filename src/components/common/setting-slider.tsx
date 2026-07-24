'use client';

/**
 * 统一的设置滑块组件：取代原先 `rounded-xl border border-border bg-card p-5`
 * 里要么用裸 `<input type="range">`、要么用 `NumberInput` 的两种风格。
 *
 * 设计目标：
 *   - 所有数字设置项（Temperature、Max tokens、Min score、Search limit …）
 *     在同一卡片里呈现一致的结构：
 *       ┌─ [label + 描述]                            [value] ┐
 *       │ [slider ────────────────────●────────────]         │
 *       └─ [min]              [mid]              [max] ──────┘
 *   - 接受 [min, max] + step；既支持小数（step < 1）也支持整数
 *   - 自定义显示格式化（百分比 / "不限" 特殊值 / 千分位）
 *   - 自动从 props 同步 value（受控），无需本地 draft state
 *   - onValidationChange 在越界 / 非法输入时上报，由父组件聚合禁用保存
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getSettingNumberRange } from '@/lib/setting-number-ranges';

export interface SettingSliderProps {
  /** 设置项 key — 用于自动从 `setting-number-ranges.ts` 拉取 [min, max, step]，并便于调试定位 */
  settingKey?: string;
  /** label（卡片主标题） */
  label: string;
  /** 描述（label 下方 caption） */
  description?: string;
  /** 当前值字符串格式，例如 "0.7" / "2048" */
  value: string;
  /** 失焦/越界/格式异常时的兜底值 */
  fallback: string;
  /**
   * 区间下界（含）。如果同时传了 `settingKey`，`settingKey` 优先；本 prop 仅在未传
   * `settingKey` 或 `settingKey` 未注册时生效。
   */
  min?: number;
  /** 区间上界（含）。同 `min` 优先级规则 */
  max?: number;
  /** 步长。`settingKey` 存在时自动按整数 1 / 浮点 0.05 推断，本 prop 覆盖 */
  step?: number;
  /** 顶部右侧值显示：默认 toString(value)；传入则完全接管 */
  renderValue?: (rawValue: number, stringValue: string) => string;
  /** 滑块下方三个档位提示：[min, mid, max]；不传则只显示当前 min/max */
  marks?: readonly (readonly [number, string])[];
  /** 值变更回调：传归一化后的字符串（例如 "05" -> "5"） */
  onChange: (normalized: string) => void;
  /** 校验状态回调 */
  onValidationChange?: (isValid: boolean, error: string | null) => void;
  /** 自定义 id */
  id?: string;
}

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

function clampAndNormalize(
  raw: string,
  min: number,
  max: number,
  step: number,
): { valid: boolean; error: string | null; normalized: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { valid: false, error: '不能为空', normalized: raw };
  }
  if (!NUMBER_PATTERN.test(trimmed)) {
    return { valid: false, error: '请输入有效数字', normalized: raw };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { valid: false, error: '请输入有效数字', normalized: raw };
  }
  const isIntegerField = Number.isInteger(step) && step >= 1;
  if (isIntegerField && !Number.isInteger(num)) {
    return { valid: false, error: '必须为整数', normalized: raw };
  }
  if (num < min || num > max) {
    return { valid: false, error: `范围 ${min}~${max}`, normalized: raw };
  }
  let normalized = String(num);
  if (step > 0 && step < 1) {
    const decimals = String(step).split('.')[1]?.length ?? 0;
    if (decimals > 0) {
      normalized = num.toFixed(decimals);
      if (normalized.includes('.')) {
        normalized = normalized.replace(/\.?0+$/, '') || '0';
      }
    }
  }
  return { valid: true, error: null, normalized };
}

export function SettingSlider({
  settingKey,
  label,
  description,
  value,
  fallback,
  min: minProp,
  max: maxProp,
  step: stepProp,
  renderValue,
  marks,
  onChange,
  onValidationChange,
  id,
}: SettingSliderProps) {
  // Resolve bounds: settingKey → props → fallback [0, 1]
  const { min, max, step } = useMemo(() => {
    const fromKey = settingKey ? getSettingNumberRange(settingKey) : null;
    if (fromKey) {
      const inferredStep = stepProp ?? (fromKey.integer ? 1 : 0.05);
      return { min: fromKey.min, max: fromKey.max, step: inferredStep };
    }
    if (typeof minProp === 'number' && typeof maxProp === 'number') {
      return { min: minProp, max: maxProp, step: stepProp ?? 1 };
    }
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[SettingSlider] "${label ?? settingKey ?? '(unnamed)'}" 没有传 settingKey，也没传 min/max — 兜底使用 [0, 1]`,
      );
    }
    return { min: 0, max: 1, step: stepProp ?? 1 };
  }, [settingKey, minProp, maxProp, stepProp, label]);
  const reportValidity = useCallback(() => {
    if (!onValidationChange) return;
    const result = clampAndNormalize(value, min, max, step);
    onValidationChange(result.valid, result.error);
  }, [onValidationChange, value, min, max, step]);

  // value 变化即重新校验，让父组件聚合多个滑块的总状态
  const lastReportedRef = useRef<{ value: string; valid: boolean } | null>(null);
  useEffect(() => {
    if (!onValidationChange) return;
    const result = clampAndNormalize(value, min, max, step);
    const last = lastReportedRef.current;
    if (!last || last.value !== value || last.valid !== result.valid) {
      lastReportedRef.current = { value, valid: result.valid };
      onValidationChange(result.valid, result.error);
    }
  }, [value, min, max, step, onValidationChange]);

  const handleSlider = (next: string) => {
    const result = clampAndNormalize(next, min, max, step);
    if (result.valid) {
      onChange(result.normalized);
      // 滑块拖动不会产生错误，校验态由 effect 跟上
    } else {
      // 通常不会触发（slider 受 min/max/step 约束），做兜底：仍把
      // 原始值上抛，让父组件知道，再由 user 拖回合法区。
      onChange(next);
    }
    reportValidity();
  };

  const currentValue = (() => {
    if (NUMBER_PATTERN.test(value.trim())) {
      return value;
    }
    return fallback;
  })();

  const numericCurrent = Number(currentValue);
  const displayText = renderValue
    ? renderValue(Number.isFinite(numericCurrent) ? numericCurrent : Number(fallback), currentValue)
    : Number.isInteger(step) && step >= 1
      ? String(Math.round(numericCurrent))
      : Number.isFinite(numericCurrent)
        ? numericCurrent.toFixed(String(step).split('.')[1]?.length ?? 1).replace(/\.?0+$/, '') || '0'
        : currentValue;

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-setting-key={settingKey}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor={id}
            className="text-xs font-medium text-foreground block"
          >
            {label}
          </label>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <span className="shrink-0 inline-flex items-center justify-center min-w-[3rem] px-2 py-0.5 rounded-md bg-primary/10 text-primary text-sm font-semibold tabular-nums">
          {displayText}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        onChange={(e) => handleSlider(e.target.value)}
        className="w-full accent-primary cursor-pointer"
      />
      {marks && marks.length > 0 && (
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5 px-0.5">
          {marks.map(([v, labelText], idx) => (
            <span key={`${v}-${idx}`} className="flex flex-col items-center gap-0.5">
              <span className="hidden" aria-hidden>
                {v}
              </span>
              <span>{labelText}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
