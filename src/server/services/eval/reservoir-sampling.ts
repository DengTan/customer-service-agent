/**
 * Reservoir sampling utilities — Phase 6 (P4 RAG Evaluation Rollout)
 *
 * Implements Algorithm R (reservoir sampling, single pass) so that a fixed
 * sample size k can be drawn from a large population reproducibly:
 *
 *   - Same (population, k) pair → same sample every time (deterministic with
 *     a fixed Math.random sequence — used in tests).
 *   - O(n) time, O(k) space — no need to load the full population.
 *   - k items are always returned (or all n items when k >= n).
 */

/**
 * Reservoir sampling (Algorithm R).
 *
 * @param population  Ordered array to sample from.
 * @param k           Number of items to select.
 * @returns           Array of exactly `k` distinct items from population.
 */
export function reservoirSample<T>(population: T[], k: number): T[] {
  const n = population.length;
  if (k <= 0) return [];
  if (k >= n) return [...population];

  const reservoir: T[] = population.slice(0, k);
  for (let i = k; i < n; i++) {
    // j is uniform in [0, i] inclusive — Algorithm R
    const j = Math.floor(Math.random() * (i + 1));
    if (j < k) {
      reservoir[j] = population[i];
    }
  }
  return reservoir;
}
