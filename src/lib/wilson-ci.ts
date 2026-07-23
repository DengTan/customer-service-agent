/**
 * Wilson score confidence interval for a proportion.
 * @param p  observed proportion (0..1)
 * @param n  sample size
 * @param z  z-score for confidence level (default 1.96 for 95%)
 */
export function wilsonCI(
  p: number,
  n: number,
  z = 1.96,
): {
  value: number;
  ci_lower: number;
  ci_upper: number;
} {
  if (n === 0) return { value: p, ci_lower: 0, ci_upper: 1 };
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    value: p,
    ci_lower: Math.max(0, (center - margin) / denom),
    ci_upper: Math.min(1, (center + margin) / denom),
  };
}
