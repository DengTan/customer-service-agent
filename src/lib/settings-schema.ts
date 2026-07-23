/**
 * Single source of truth for the system settings schema.
 *
 * Plan `settings-rls-hardening_5c312208.plan.md` (phase 1) requires that
 * the writable-allowlist, the "resettable" key set and the seeding defaults
 * all derive from one place so the UI, the service validation, the seed
 * path and the reset path cannot drift apart.
 *
 * Conventions:
 *   - `WRITABLE_SETTING_KEYS` is the allowlist of keys the generic
 *     `PUT /api/settings` endpoint may write. Server-internal / secret
 *     keys (LLM API keys, webhook secrets, Gorgias credentials, etc.)
 *     are deliberately NOT writable here; they each have a dedicated
 *     scope-narrow API route.
 *   - `RESETTABLE_DEFAULTS` is the key set + values used by the dedicated
 *     `reset_settings_to_defaults` RPC and the matching `/api/settings/reset`
 *     endpoint. It must reset every general system setting (including
 *     `system_prompt`) and MUST NOT touch any third-party integration key,
 *     any webhook secret, `custom_tools` or anything that is a Bot / Shop
 *     property stored outside the `settings` table.
 *   - `SERVER_SEED_DEFAULTS` is the seed payload used by the initial
 *     setup RPC `seed_system_defaults`. Currently identical to
 *     `FACTORY_DEFAULTS_WITH_PROMPT` (the union of the client-safe
 *     factory defaults and the default LLM system prompt).
 *
 * The runtime validator (`SettingsService.validateSettings`) reads from
 * `WRITABLE_SETTING_KEYS`; the reset API reads from `RESETTABLE_DEFAULTS`;
 * the seed RPC reads from `SERVER_SEED_DEFAULTS`. The UI never sends the
 * reset payload — it is fixed server-side so a client cannot trick the
 * endpoint into "resettable" keys that are actually integration keys.
 */
import { FACTORY_DEFAULTS_WITH_PROMPT } from './server-only-settings-defaults';

/**
 * Allowlist of keys the generic `PUT /api/settings` may write.
 *
 * Keys NOT in this set fall into one of three buckets:
 *   - server-managed secrets (LLM API keys, Gorgias / Push webhook
 *     secrets, etc.) — each has its own dedicated API route;
 *   - deprecated keys (`unhandled_remind` boolean-as-minutes bug);
 *   - keys belonging to other tables (Bot / Shop / Queue / etc.).
 */
export const WRITABLE_SETTING_KEYS: ReadonlySet<string> = new Set<string>([
  // Dialog control
  'welcome_message',
  'session_timeout',
  'max_turns',
  'rating_enabled',
  'new_conversation_notify',
  'unhandled_remind_enabled',
  'unhandled_remind_minutes',
  // Alert thresholds
  'alert_confidence_threshold',
  'alert_confidence_critical_threshold',
  'alert_high_rounds_threshold',
  'alert_high_rounds_critical_threshold',
  'alert_auto_handoff_rounds',
  // AI model
  'ai_model_enabled',
  'ai_model',
  'llm_provider_id',
  'multimodal_enabled',
  'multimodal_model',
  'multimodal_disabled_action',
  'multimodal_fixed_message',
  'ai_temperature',
  'ai_max_tokens',
  'ai_max_concurrent',
  // Knowledge retrieval
  'knowledge_min_score',
  'knowledge_search_limit',
  'knowledge_image_search_limit',
  // Knowledge chunking
  'knowledge_smart_chunking_enabled',
  'knowledge_chunk_size',
  'knowledge_chunk_overlap',
  // Content security
  'content_filter_enabled',
  'sensitive_word_filter_enabled',
  'url_filter_enabled',
  'url_filter_mode',
  'sensitive_word_default_action',
  'sensitive_word_block_message',
  'sensitive_word_warn_message',
  'url_block_message',
  // Knowledge self-learning
  'knowledge_learning_confidence_threshold',
  'knowledge_learning_scan_interval_hours',
  'knowledge_learning_auto_scan_enabled',
  // Appearance
  'theme',
  'font_size',
  'show_timestamps',
  'compact_mode',
  // Bot quota
  'max_main_bots',
  // Bot configuration
  'custom_tools',
]);

/**
 * Keys that are NEVER saved through the generic `PUT /api/settings` endpoint.
 *
 * These fall into three categories:
 *   1. Server-managed keys (set by the server, not the UI):
 *        - gorgias_webhook_secret_encrypted: set server-side after validation
 *        - external_knowledge_*: managed by /api/knowledge/external/settings
 *        - retrieval_hybrid_config: server-computed hybrid retrieval config
 *        - knowledge_image_max_citations: computed/derived setting
 *   2. Operator-managed Bot config
 *   3. Integration secrets (LLM API keys, webhook secrets, etc.)
 *
 * The frontend uses this set to filter keys before calling PUT /api/settings.
 * The server-side SettingsService also blocks these via WRITABLE_SETTING_KEYS
 * as a defense-in-depth measure.
 */
export const NON_RESETTABLE_KEYS: ReadonlySet<string> = new Set<string>([
  // Server-managed keys (managed by dedicated API routes, not writable via generic endpoint)
  'gorgias_webhook_secret_encrypted',
  'external_knowledge_enabled',
  'external_knowledge_provider',
  'external_knowledge_base_url',
  'external_knowledge_dataset_id',
  'external_knowledge_search_mode',
  'external_knowledge_use_rerank',
  'external_knowledge_api_key',
  'retrieval_hybrid_config',
  'knowledge_image_max_citations',
  // Operator-managed Bot config (also excluded from resettable)
  'custom_tools',
  // Gorgias integration
  'gorgias_api_key',
  'gorgias_email',
  'gorgias_domain',
  'gorgias_webhook_secret',
  'gorgias_enabled',
  'gorgias_sync_enabled',
  'gorgias_sync_interval_minutes',
  // Push integration
  'push_webhook_secret',
  // LLM provider secrets
  'llm_provider_api_key',
  'llm_provider_bearer_token',
  'openai_api_key',
  'anthropic_api_key',
  'coze_api_key',
  // Legacy webhook secret
  'webhook_secret',
]);

/**
 * "恢复出厂" payload — the set of keys + their default values that the
 * dedicated `reset_settings_to_defaults(jsonb, text[])` RPC and the
 * `/api/settings/reset` endpoint will write.
 *
 * Scope:
 *   INCLUDES every general system setting (dialog control, alert
 *     thresholds, AI model config, knowledge retrieval/chunking, content
 *     security, knowledge self-learning, appearance, bot quota, AND the
 *     default `system_prompt`).
 *   EXCLUDES `custom_tools` (operator-managed Bot config), all
 *     third-party integration keys/secrets (Gorgias, Push, LLM) and
 *     anything that lives outside the `settings` table (Bot configs,
 *     Shop configs, etc.).
 *
 * Note: this is the literal payload. Server-side code MUST also enforce
 * the `NON_RESETTABLE_KEYS` allowlist before any value is written; this
 * object is the *intended* reset set, not a *trust boundary*.
 */
export const RESETTABLE_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  ...FACTORY_DEFAULTS_WITH_PROMPT,
});

/**
 * Seed payload used by the initial-setup `seed_system_defaults(jsonb)`
 * RPC and the matching repository helper.
 *
 * Identical to `FACTORY_DEFAULTS_WITH_PROMPT` today. The naming is
 * deliberate: future contributors should reach for `SERVER_SEED_DEFAULTS`
 * in seed code rather than `FACTORY_DEFAULTS_WITH_PROMPT`, so the
 * seeding path can evolve independently (e.g. exclude deprecated keys)
 * without breaking the reset path.
 */
export const SERVER_SEED_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  ...FACTORY_DEFAULTS_WITH_PROMPT,
});

/**
 * Returns true iff `key` is included in `RESETTABLE_DEFAULTS`.
 * Pure derived check — no I/O.
 */
export function isResettable(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(RESETTABLE_DEFAULTS, key);
}

/**
 * Returns true iff `key` is allowed by the generic `PUT /api/settings`
 * allowlist.
 */
export function isWritable(key: string): boolean {
  return WRITABLE_SETTING_KEYS.has(key);
}

/**
 * Assert that `key` is in the writable allowlist. Throws `Error` with a
 * stable code `SETTINGS_KEY_NOT_WRITABLE` otherwise. Used by the
 * `SettingsService.validateSettings` flow to surface precise error
 * messages and to keep a single code path for the rejection.
 */
export function assertWritable(key: string): void {
  if (!isWritable(key)) {
    const err = new Error(`setting key not writable: ${key}`);
    (err as Error & { code?: string }).code = 'SETTINGS_KEY_NOT_WRITABLE';
    throw err;
  }
}