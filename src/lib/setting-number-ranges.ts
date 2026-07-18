/**
 * Single source of truth for the min/max bounds of numeric setting keys.
 *
 * Why this lives in `lib/` (not in the service):
 *   - The UI (settings-page, ai-settings, alert-settings, chat-settings,
 *     knowledge-learning-settings, …) needs the same ranges as the server
 *     to keep the client-side NumberInput in lock-step with
 *     SettingsService.validateSettings. If we duplicated the maps, a future
 *     PR that tightens one side would silently desync from the other.
 *   - `server/services/settings-service.ts` re-imports these constants so
 *     the runtime validator, the seeds, and the reset payload all use the
 *     same bounds. There is no second copy anywhere.
 *
 * Adding a new bounded setting:
 *   1. Add the key to one of the maps below.
 *   2. Add it to WRITABLE_SETTING_KEYS in `lib/settings-schema.ts` if not
 *      already present.
 *   3. Wire the UI: pass `min`/`max` (or read from `getSettingNumberRange`)
 *      into a `NumberInput` instance and report validity via
 *      `onValidationChange`.
 *
 * `getSettingNumberRange` is provided as a convenience for code that wants
 * to drive multiple NumberInputs from the same source; the current settings
 * sub-sections still hard-code `min`/`max` for readability. If you wire it
 * up automatically, keep the fallback default per field in sync with the
 * factory defaults in `server-only-settings-defaults.ts`.
 */

/**
 * Integer-bounded settings: must parse to a finite integer in [min, max].
 * Step on the UI input is `1` (whole numbers only).
 */
export const INTEGER_RANGE_KEYS: Record<string, { min: number; max: number }> = {
  session_timeout: { min: 0, max: 24 * 60 },
  max_turns: { min: 0, max: 1_000 },
  unhandled_remind_minutes: { min: 1, max: 24 * 60 },
  alert_high_rounds_threshold: { min: 1, max: 1_000 },
  alert_high_rounds_critical_threshold: { min: 1, max: 1_000 },
  alert_auto_handoff_rounds: { min: 1, max: 1_000 },
  ai_max_tokens: { min: 1, max: 32_000 },
  ai_max_concurrent: { min: 0, max: 10_000 },
  knowledge_search_limit: { min: 1, max: 50 },
  knowledge_image_search_limit: { min: 0, max: 20 },
  knowledge_chunk_size: { min: 50, max: 4_000 },
  knowledge_chunk_overlap: { min: 0, max: 2_000 },
  knowledge_learning_scan_interval_hours: { min: 1, max: 24 * 30 },
  font_size: { min: 8, max: 32 },
  max_main_bots: { min: 1, max: 1_000 },
};

/**
 * Float-bounded settings: must parse to a finite number in [min, max].
 * Step on the UI input is `0.05` (two-decimal precision).
 */
export const FLOAT_RANGE_KEYS: Record<string, { min: number; max: number }> = {
  alert_confidence_threshold: { min: 0, max: 1 },
  alert_confidence_critical_threshold: { min: 0, max: 1 },
  knowledge_min_score: { min: 0, max: 1 },
  knowledge_learning_confidence_threshold: { min: 0, max: 1 },
  ai_temperature: { min: 0, max: 2 },
};

/**
 * Return the bounds for `key` regardless of which map it lives in, or
 * `null` if the key is not bounded (free-form). Useful for the UI when it
 * wants to know whether a given setting needs numeric validation at all.
 */
export function getSettingNumberRange(key: string): { min: number; max: number; integer: boolean } | null {
  if (key in INTEGER_RANGE_KEYS) {
    const { min, max } = INTEGER_RANGE_KEYS[key];
    return { min, max, integer: true };
  }
  if (key in FLOAT_RANGE_KEYS) {
    const { min, max } = FLOAT_RANGE_KEYS[key];
    return { min, max, integer: false };
  }
  return null;
}