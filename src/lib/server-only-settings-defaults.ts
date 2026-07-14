/**
 * 服务端专用的系统设置出厂默认值（含完整 system_prompt）。
 *
 * 服务端代码（UserService / 后台任务等）需要写入完整的 system_prompt，
 * 而客户端 bundle 不应包含 LLM 系统提示词 —— 因此将含 `system_prompt`
 * 的常量放在独立模块。客户端代码请继续从 `@/lib/settings-defaults`
 * 导入 `FACTORY_DEFAULTS`（不含 system_prompt）。
 *
 * 常量 SETTINGS_SEED_LOCK_KEY 是 advisory lock 的数字常量，详见
 * `supabase/migrations/20260710_settings_seeding_lock.sql`。
 * 选择该数字的原因：6 位整数，与项目内其他 RPC（订单号、消息计数等）的
 * advisory lock key 互不冲突（其他 RPC key 见 supabase/migrations）。
 */
import { FACTORY_DEFAULTS, DEFAULT_SYSTEM_PROMPT } from './settings-defaults';

export const FACTORY_DEFAULTS_WITH_PROMPT: Record<string, string> = {
  ...FACTORY_DEFAULTS,
  system_prompt: DEFAULT_SYSTEM_PROMPT,
};

/**
 * Postgres advisory lock key (bigint) used by
 * `try_acquire_settings_seed_lock()` to serialize concurrent seeding calls.
 */
export const SETTINGS_SEED_LOCK_KEY = 8247193;

/**
 * Sentinel setting key. The first-time seed only runs if this key is absent
 * from the settings table. `system_prompt` is the most representative choice:
 * it is one of the most user-facing defaults and is never inserted by the
 * content-filter / webhook migrations that pre-seed the table on fresh deploys.
 */
export const SETTINGS_SENTINEL_KEY = 'system_prompt';

export { FACTORY_DEFAULTS, DEFAULT_SYSTEM_PROMPT } from './settings-defaults';