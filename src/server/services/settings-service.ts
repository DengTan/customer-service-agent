import { SettingsRepository } from '@/server/repositories/settings-repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';
import { isDemoMode } from '@/storage/database/supabase-client';
import { WRITABLE_SETTING_KEYS } from '@/lib/settings-schema';
import {
  INTEGER_RANGE_KEYS,
  FLOAT_RANGE_KEYS,
} from '@/lib/setting-number-ranges';
import { invalidateKnowledgeSearchSettingsCache } from './knowledge-search-service';
import { FeatureFlagService } from './feature-flag-service';
import { ContentFilterService } from './content-filter-service';

/**
 * Keys whose values must be parsed as JSON before persisting.
 * Bot-settings.tsx sends `custom_tools` as a JSON-stringified array.
 */
const JSON_VALUE_KEYS = new Set(['custom_tools']);

/**
 * Keys whose values must be exactly 'true' or 'false' (boolean toggles).
 * Anything else is rejected.
 */
const BOOLEAN_KEYS = new Set([
  'rating_enabled',
  'new_conversation_notify',
  'unhandled_remind_enabled',
  'ai_model_enabled',
  'multimodal_enabled',
  'knowledge_smart_chunking_enabled',
  'content_filter_enabled',
  'sensitive_word_filter_enabled',
  'url_filter_enabled',
  'show_timestamps',
  'compact_mode',
  'knowledge_learning_auto_scan_enabled',
]);

/**
 * Enum-typed keys: value must be one of the listed alternatives.
 */
const ENUM_KEYS: Record<string, readonly string[]> = {
  theme: ['system', 'light', 'dark'],
  url_filter_mode: ['whitelist', 'blacklist'],
  sensitive_word_default_action: ['block', 'replace', 'warn'],
  multimodal_disabled_action: ['fixed_message', 'handoff'],
};

/**
 * Legacy "non-negative number" keys — kept for backwards compatibility
 * with any setting that wasn't promoted to INTEGER_RANGE_KEYS above.
 */
const LEGACY_NON_NEGATIVE_NUMERIC_KEYS = new Set([
  'max_turns',
  'session_timeout',
  'ai_max_tokens',
  'ai_max_concurrent',
  'knowledge_search_limit',
  'knowledge_image_search_limit',
  'knowledge_chunk_size',
  'knowledge_chunk_overlap',
  'font_size',
  'knowledge_learning_confidence_threshold',
  'knowledge_learning_scan_interval_hours',
]);

/**
 * Free-text string keys: must be a non-empty string up to MAX_LEN.
 * Keys not in this map fall through to the generic string-length check.
 */
const FREE_TEXT_KEYS = new Set([
  'welcome_message',
  'system_prompt',
  'multimodal_fixed_message',
  'sensitive_word_block_message',
  'sensitive_word_warn_message',
  'url_block_message',
]);

const MAX_FREE_TEXT_LENGTH = 4_000;
const MAX_SHORT_STRING_LENGTH = 200;

/**
 * Type for a validated settings payload returned by validateSettings().
 */
export interface ValidatedSettings {
  filtered: Record<string, string>;
  valid: boolean;
  invalidKeys: string[];
  invalidValues: Array<{ key: string; value: unknown }>;
  errorCode?: string;
  errorMessage?: string;
}

export class SettingsService {
  constructor(
    private readonly settings: SettingsRepository = new SettingsRepository(),
  ) {}

  // Expose the constructor type so callers can instantiate a repository
  // with a custom Supabase client and pass it in.
  static readonly RepositoryConstructor: new (client: SupabaseClient) => SettingsRepository =
    SettingsRepository;

  /**
   * Server-internal / secret keys. These are NEVER returned to non-admin
   * callers and are never writable via the generic PUT endpoint — they
   * each have their own dedicated, scope-narrow API (e.g. /api/gorgias/settings).
   */
  static readonly SECRET_KEYS: readonly string[] = [
    'gorgias_api_key',
    'gorgias_email',
    'gorgias_domain',
    'gorgias_webhook_secret',
    'push_webhook_secret',
    'llm_provider_api_key',
    'llm_provider_bearer_token',
    'openai_api_key',
    'anthropic_api_key',
    'webhook_secret',
    'system_prompt',
  ] as const;

  /**
   * Fetch the full settings map. When `isAdmin` is false, secret keys are stripped
   * from the returned map to prevent inadvertent exposure to non-admin roles.
   *
   * `system_prompt` is treated as a secret too because (a) it can encode
   * proprietary prompt-engineering that admins don't want leaked to other
   * roles and (b) the AI settings UI page is admin-only. Server-side code
   * that needs `system_prompt` reads it from `SettingsRepository` directly
   * when serving admin-only flows.
   */
  async getSettingsMap(isAdmin = true): Promise<Record<string, string>> {
    try {
      const rows = await this.settings.list();
      const map = rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});

      if (isAdmin) return map;

      // Strip server-internal / secret keys for non-admin callers
      for (const key of SettingsService.SECRET_KEYS) {
        delete map[key];
      }
      return map;
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch settings');
    }
  }

  /**
   * Validate and sanitize a settings PUT payload.
   *
   * Rules:
   *   1. Only keys in ALLOWED_WRITE_KEYS are accepted. Anything else
   *      (secret keys, unknown keys, deprecated keys) is rejected.
   *   2. Boolean keys must be exactly 'true' or 'false'.
   *   3. Integer-range keys must parse to an integer in the configured
   *      [min, max] range.
   *   4. Float-range keys must parse to a finite number in [min, max].
   *   5. Enum keys must match one of the configured alternatives.
   *   6. JSON keys must parse to a valid JSON value.
   *   7. Free-text keys have length caps.
   *
   * Returns a ValidatedSettings object so the route can return precise error info.
   */
  static validateSettings(
    raw: unknown,
  ): ValidatedSettings {
    const invalidKeys: string[] = [];
    const invalidValues: Array<{ key: string; value: unknown }> = [];
    const filtered: Record<string, string> = {};

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { filtered, valid: false, invalidKeys: ['<root>'], invalidValues: [] };
    }

    const entries = Object.entries(raw as Record<string, unknown>);

    for (const [key, value] of entries) {
      // Rule 1: allowlist check — block all secret keys and unknown keys.
      // `key` is typed as `string` (from Object.entries) but the allowlist
      // was declared `as const`, so we widen it explicitly to `string`.
      if (!WRITABLE_SETTING_KEYS.has(key)) {
        invalidKeys.push(key);
        continue;
      }

      // Rule 2: boolean keys.
      if (BOOLEAN_KEYS.has(key)) {
        if (typeof value === 'boolean') {
          filtered[key] = String(value);
          continue;
        }
        if (value === 'true' || value === 'false') {
          filtered[key] = value;
          continue;
        }
        invalidValues.push({ key, value });
        continue;
      }

      // Rule 3: integer-range keys.
      const intRange = INTEGER_RANGE_KEYS[key];
      if (intRange) {
        const num = Number(value);
        if (
          !Number.isFinite(num) ||
          !Number.isInteger(num) ||
          num < intRange.min ||
          num > intRange.max
        ) {
          invalidValues.push({ key, value });
          continue;
        }
        filtered[key] = String(num);
        continue;
      }

      // Rule 4: float-range keys.
      const floatRange = FLOAT_RANGE_KEYS[key];
      if (floatRange) {
        const num = Number(value);
        if (!Number.isFinite(num) || num < floatRange.min || num > floatRange.max) {
          invalidValues.push({ key, value });
          continue;
        }
        filtered[key] = String(num);
        continue;
      }

      // Rule 5: enum keys.
      const allowedValues = ENUM_KEYS[key];
      if (allowedValues) {
        if (typeof value !== 'string' || !allowedValues.includes(value)) {
          invalidValues.push({ key, value });
          continue;
        }
        filtered[key] = value;
        continue;
      }

      // Rule 6: JSON-typed keys.
      if (JSON_VALUE_KEYS.has(key)) {
        if (typeof value !== 'string') {
          invalidValues.push({ key, value });
          continue;
        }
        try {
          // Round-trip parse to ensure the JSON is valid; re-stringify so
          // the stored value is canonical (avoids double-encoding later).
          const parsed = JSON.parse(value);
          filtered[key] = JSON.stringify(parsed);
          continue;
        } catch {
          invalidValues.push({ key, value });
          continue;
        }
      }

      // Rule 7: free-text vs short string length cap.
      const maxLen = FREE_TEXT_KEYS.has(key) ? MAX_FREE_TEXT_LENGTH : MAX_SHORT_STRING_LENGTH;
      if (typeof value !== 'string') {
        invalidValues.push({ key, value });
        continue;
      }
      if (value.length > maxLen) {
        invalidValues.push({ key, value: `<${value.length} chars>` });
        continue;
      }
      filtered[key] = value;
    }

    // Rule 8: threshold relationship validation
    // Critical threshold must be strictly less than Warning threshold.
    // This is a cross-field constraint that can't be expressed in single-field rules.
    const confidenceWarning = parseFloat(filtered['alert_confidence_threshold'] ?? '');
    const confidenceCritical = parseFloat(filtered['alert_confidence_critical_threshold'] ?? '');
    if (Number.isFinite(confidenceWarning) && Number.isFinite(confidenceCritical)) {
      if (confidenceCritical >= confidenceWarning) {
        return {
          filtered,
          valid: false,
          invalidKeys: [],
          invalidValues: [],
          errorCode: 'INVALID_THRESHOLD_RELATION',
          errorMessage: `严重告警阈值 (${confidenceCritical.toFixed(2)}) 必须小于告警阈值 (${confidenceWarning.toFixed(2)})`,
        };
      }
    }

    const roundsWarning = parseInt(filtered['alert_high_rounds_threshold'] ?? '', 10);
    const roundsCritical = parseInt(filtered['alert_high_rounds_critical_threshold'] ?? '', 10);
    if (Number.isFinite(roundsWarning) && Number.isFinite(roundsCritical)) {
      if (roundsCritical <= roundsWarning) {
        return {
          filtered,
          valid: false,
          invalidKeys: [],
          invalidValues: [],
          errorCode: 'INVALID_THRESHOLD_RELATION',
          errorMessage: `严重告警轮次 (${roundsCritical}) 必须大于告警轮次 (${roundsWarning})`,
        };
      }
    }

    const valid = invalidKeys.length === 0 && invalidValues.length === 0;
    return { filtered, valid, invalidKeys, invalidValues };
  }

  /**
   * Update settings with validation + atomic RPC.
   *
   * Goes through `SettingsRepository.upsertManyAtomic`, which calls the
   * `upsert_settings_batch` SECURITY DEFINER RPC and falls back to the
   * legacy `upsert_many_settings` RPC or per-row upserts as needed.
   *
   * After persisting, invalidates all downstream in-memory caches so the next
   * request picks up the new values without waiting for TTL expiry:
   *   - knowledge-search settings cache (knowledge_min_score, _search_limit, _image_search_limit)
   *   - content-filter cache (sensitive words, allowed domains)
   *   - feature-flag cache (eval_*, EVAL_* flags)
   */
  async updateSettings(
    settings: Record<string, string> | undefined,
  ): Promise<void> {
    if (!settings || typeof settings !== 'object') {
      throw new ServiceError('Invalid settings payload', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    // Double-check with the static validator (belt-and-suspenders)
    const validated = SettingsService.validateSettings(settings);
    if (!validated.valid) {
      throw new ServiceError(validated.errorMessage || 'Invalid settings payload', {
        status: 400,
        code: validated.errorCode || 'VALIDATION_ERROR',
      });
    }

    try {
      if (!isDemoMode()) {
        await this.settings.upsertManyAtomic(validated.filtered);
        logger.info('[SettingsService] Upserted settings', {
          count: Object.keys(validated.filtered).length,
        });
      } else {
        // Demo mode: log and skip
        logger.debug('[SettingsService] Demo mode - settings upsert skipped', {
          count: Object.keys(validated.filtered).length,
        });
      }
    } catch (error) {
      throw toServiceError(error, 'Failed to update settings');
    }

    // -- Cache invalidation --------------------------------------------------------
    // Any settings change (custom_tools, knowledge thresholds, content-filter
    // toggles, feature flags, etc.) invalidates all downstream caches so the
    // next request picks up the new values without waiting for TTL expiry.
    try {
      invalidateKnowledgeSearchSettingsCache();
    } catch { /* non-fatal */ }

    try {
      new ContentFilterService().clearCache();
    } catch { /* non-fatal */ }

    try {
      FeatureFlagService.invalidateCache();
    } catch { /* non-fatal */ }
  }
}
