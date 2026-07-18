'use client';

/**
 * 受控数字输入组件 + 即时校验。
 *
 * 设计目标：解决原生 `<input type="number">` 的三个漏洞
 *   1. `min` / `max` / `step` 属性只对上下箭头/滚轮生效，对键盘直接键入完全无拦截
 *   2. 用户可以输入 "05"、"0.75"、"-1"、"abc" 等任何字符串
 *   3. 失焦后不会出现错误提示，脏数据被静默上传后端
 *
 * 校验规则（与后端 SettingsService.validateSettings 对齐）：
 *   - 空字符串: 错误 "不能为空"
 *   - 非数字字符 / 非法格式（含科学计数法）: 错误 "请输入有效数字"
 *   - 整数字段填了小数: 错误 "必须为整数"
 *   - 超出 [min, max] 范围: 错误 "范围 min~max"
 *
 * 交互细节：
 *   - 实时红框 + 下方错误文案（typing 过程中）
 *   - 失焦时若合法，自动归一化为 String(Number(raw))（"05" -> "5"）
 *   - 失焦时若为空，回填为 fallback（默认是 currentValue，再不行用默认值）
 *   - 上下箭头受 min/max/step 约束
 *   - onValidationChange 回调让父组件禁用保存按钮
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';

export interface NumberInputProps {
  /** 当前值（字符串格式，与 settings 表保持一致） */
  value: string;
  /** 校验通过时回调（返回归一化后的字符串） */
  onChange: (normalized: string) => void;
  /** 校验失败时回调，父组件可用它禁用保存按钮 */
  onValidationChange?: (isValid: boolean, error: string | null) => void;
  /** 最小值（含） */
  min: number;
  /** 最大值（含） */
  max: number;
  /** 步长（决定浮点/整数字段） */
  step?: number;
  /** 缺省值：失焦且输入框为空时回填 */
  fallback?: string;
  /** placeholder */
  placeholder?: string;
  /** 禁用 */
  disabled?: boolean;
  /** 自定义 className */
  className?: string;
  /** aria-label */
  'aria-label'?: string;
  /** id */
  id?: string;
}

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

export function validateNumberInput(
  raw: string,
  opts: { min: number; max: number; step?: number },
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

  // 整数字段（step >= 1 且 step 为整数）拒绝小数
  const isIntegerField =
    opts.step !== undefined && Number.isInteger(opts.step) && opts.step >= 1;
  if (isIntegerField && !Number.isInteger(num)) {
    return { valid: false, error: '必须为整数', normalized: raw };
  }

  if (num < opts.min || num > opts.max) {
    return {
      valid: false,
      error: `范围 ${opts.min}~${opts.max}`,
      normalized: raw,
    };
  }

  // 归一化: "05" -> "5", "1.50" -> "1.5"（保留 step 的精度）
  let normalized = String(num);
  if (opts.step !== undefined && opts.step < 1) {
    const decimals = String(opts.step).split('.')[1]?.length ?? 0;
    if (decimals > 0) {
      normalized = num.toFixed(decimals);
      // 去尾随 0 让显示更友好：1.50 -> 1.5
      if (normalized.includes('.')) {
        normalized = normalized.replace(/\.?0+$/, '') || '0';
      }
    }
  }
  return { valid: true, error: null, normalized };
}

export function NumberInput({
  value,
  onChange,
  onValidationChange,
  min,
  max,
  step = 1,
  fallback,
  placeholder,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
}: NumberInputProps) {
  // 受控输入：本地维护正在编辑的字符串，避免父组件归一化打断用户输入
  // （例如用户键入 "0." 时光标位置会被重置）
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const lastValueRef = useRef(value);

  // 父组件 value 变化时同步本地 draft（避免外部重置后还显示旧值）
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setDraft(value);
      setError(null);
      setTouched(false);
    }
  }, [value]);

  const runValidation = useCallback(
    (raw: string): { valid: boolean; error: string | null; normalized: string } => {
      const result = validateNumberInput(raw, { min, max, step });
      setError(result.error);
      onValidationChange?.(result.valid, result.error);
      return result;
    },
    [min, max, step, onValidationChange],
  );

  // 初始挂载 + 校验参数变化时重新报告一次校验状态。
  // （例如父组件异步加载完成后下发真实的 min/max/step；又或者
  // value 的 useEffect 已经在外部同步过 draft，这里再校验一次
  // 触发 onValidationChange，让父组件聚合逻辑知道当前是 valid。）
  useEffect(() => {
    const result = validateNumberInput(draft, { min, max, step });
    setError(result.error);
    onValidationChange?.(result.valid, result.error);
  }, [min, max, step]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDraft(next);
    runValidation(next);
  };

  const handleBlur = () => {
    setTouched(true);
    const result = runValidation(draft);
    if (result.valid) {
      // 合法时归一化（例如 "05" -> "5"）
      if (result.normalized !== draft) {
        setDraft(result.normalized);
        lastValueRef.current = result.normalized;
        onChange(result.normalized);
      } else if (draft !== value) {
        lastValueRef.current = draft;
        onChange(draft);
      }
    } else if (draft.trim() === '' && fallback !== undefined) {
      // 空值回填到 fallback（让用户不用必须输入合法值才能离开）
      setDraft(fallback);
      lastValueRef.current = fallback;
      setError(null);
      onValidationChange?.(true, null);
      onChange(fallback);
    }
  };

  const showError = touched && error !== null;

  return (
    <div className="w-full">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={showError}
        aria-describedby={showError ? `${id}-error` : undefined}
        className={
          'w-full px-3 py-2 rounded-lg bg-muted text-sm text-foreground focus:outline-none focus:ring-2 transition-colors ' +
          (showError
            ? 'border border-destructive ring-1 ring-destructive/30 focus:ring-destructive/40'
            : 'border-none focus:ring-primary/30') +
          ' ' +
          (className ?? '')
        }
      />
      {showError && (
        <p
          id={`${id}-error`}
          className="mt-1 flex items-center gap-1 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}