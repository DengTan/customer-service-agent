/**
 * Tests for the settings contract module
 * (`src/lib/settings-schema.ts`).
 *
 * The module is the single source of truth for:
 *   - the allowlist of keys the generic PUT /api/settings may write;
 *   - the derived "resettable defaults" used by the reset flow (so the
 *     UI / service / DB cannot drift on what "恢复出厂" actually means);
 *   - the derived "server seed defaults" used by initial seeding.
 *
 * Reset scope is locked in plan `settings-rls-hardening_5c312208.plan.md`
 * (phase 1): reset MUST touch general system settings and the default
 * `system_prompt`; it MUST NOT touch `custom_tools`, Bot / Shop data or
 * any third-party integration key / secret.
 */
import { describe, it, expect } from 'vitest';

import {
  WRITABLE_SETTING_KEYS,
  RESETTABLE_DEFAULTS,
  SERVER_SEED_DEFAULTS,
  NON_RESETTABLE_KEYS,
  isResettable,
  assertWritable,
} from '@/lib/settings-schema';
import { FACTORY_DEFAULTS_WITH_PROMPT } from '@/lib/server-only-settings-defaults';

describe('settings-schema — WRITABLE_SETTING_KEYS', () => {
  it('is a non-empty Set of strings', () => {
    expect(WRITABLE_SETTING_KEYS).toBeInstanceOf(Set);
    expect(WRITABLE_SETTING_KEYS.size).toBeGreaterThan(0);
    for (const k of WRITABLE_SETTING_KEYS) {
      expect(typeof k).toBe('string');
      expect(k.length).toBeGreaterThan(0);
    }
  });

  it('does not include any server-internal / secret key', () => {
    const forbidden = [
      'gorgias_api_key',
      'gorgias_email',
      'gorgias_domain',
      'gorgias_webhook_secret',
      'push_webhook_secret',
      'llm_provider_api_key',
      'llm_provider_bearer_token',
      'openai_api_key',
      'anthropic_api_key',
      'coze_api_key',
      'webhook_secret',
    ];
    for (const k of forbidden) {
      expect(WRITABLE_SETTING_KEYS.has(k)).toBe(false);
    }
  });

  it('assertWritable throws for unknown or secret keys', () => {
    expect(() => assertWritable('theme')).not.toThrow();
    expect(() => assertWritable('system_prompt')).toThrow();
    expect(() => assertWritable('gorgias_api_key')).toThrow();
    expect(() => assertWritable('never_heard_of_this')).toThrow();
  });
});

describe('settings-schema — RESETTABLE_DEFAULTS', () => {
  it('covers every key in FACTORY_DEFAULTS (the client-safe subset)', () => {
    for (const k of Object.keys(FACTORY_DEFAULTS_WITH_PROMPT)) {
      // system_prompt lives in the server-only factory defaults and is
      // explicitly part of the resettable set; every other key must be
      // included too.
      expect(RESETTABLE_DEFAULTS).toHaveProperty(k);
    }
  });

  it('includes system_prompt using the documented default value', () => {
    expect(RESETTABLE_DEFAULTS).toHaveProperty('system_prompt');
    expect(typeof RESETTABLE_DEFAULTS.system_prompt).toBe('string');
    expect(RESETTABLE_DEFAULTS.system_prompt.length).toBeGreaterThan(20);
  });

  it('does not include any Gorgias / Push / LLM / webhook secret', () => {
    const forbidden = [
      'gorgias_api_key',
      'gorgias_email',
      'gorgias_domain',
      'gorgias_webhook_secret',
      'gorgias_enabled',
      'gorgias_sync_enabled',
      'gorgias_sync_interval_minutes',
      'push_webhook_secret',
      'llm_provider_api_key',
      'llm_provider_bearer_token',
      'openai_api_key',
      'anthropic_api_key',
      'coze_api_key',
      'webhook_secret',
    ];
    for (const k of forbidden) {
      expect(RESETTABLE_DEFAULTS).not.toHaveProperty(k);
    }
  });

  it('does not include custom_tools (it is operator-managed Bot config)', () => {
    expect(RESETTABLE_DEFAULTS).not.toHaveProperty('custom_tools');
  });

  it('isResettable agrees with the keys actually present in RESETTABLE_DEFAULTS', () => {
    for (const k of Object.keys(RESETTABLE_DEFAULTS)) {
      expect(isResettable(k)).toBe(true);
    }
    expect(isResettable('gorgias_api_key')).toBe(false);
    expect(isResettable('custom_tools')).toBe(false);
    expect(isResettable('does_not_exist')).toBe(false);
  });
});

describe('settings-schema — SERVER_SEED_DEFAULTS', () => {
  it('matches FACTORY_DEFAULTS_WITH_PROMPT (server-only authoritative set)', () => {
    // Exact equality; the contract is that seed code may use either symbol
    // and they must be interchangeable. server-only-settings-defaults.ts
    // is already imported elsewhere in the codebase as the seeding source.
    expect(SERVER_SEED_DEFAULTS).toEqual(FACTORY_DEFAULTS_WITH_PROMPT);
  });

  it('contains every WRITABLE_SETTING_KEYS that has a factory default', () => {
    // The seeding code is best-effort: it fills in any missing key. Every
    // writable key with a documented default must therefore have a
    // corresponding entry in SERVER_SEED_DEFAULTS.
    for (const k of WRITABLE_SETTING_KEYS) {
      if (k in FACTORY_DEFAULTS_WITH_PROMPT) {
        expect(SERVER_SEED_DEFAULTS).toHaveProperty(k);
      }
    }
  });
});

// ── Schema invariants ──────────────────────────────────────────────────────────
// These tests catch regressions that could silently break the settings contract.
// They are independent of any runtime behaviour and must always hold.
describe('settings-schema — invariants', () => {
  it('custom_tools is writable but NOT resettable', () => {
    expect(WRITABLE_SETTING_KEYS.has('custom_tools')).toBe(true);
    expect(isResettable('custom_tools')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(RESETTABLE_DEFAULTS, 'custom_tools')).toBe(false);
  });

  it('every WRITABLE_SETTING_KEYS key is in RESETTABLE_DEFAULTS or NON_RESETTABLE_KEYS', () => {
    const violations: string[] = [];
    for (const k of WRITABLE_SETTING_KEYS) {
      const inResettable = Object.prototype.hasOwnProperty.call(RESETTABLE_DEFAULTS, k);
      const inNonResettable = NON_RESETTABLE_KEYS.has(k);
      if (!inResettable && !inNonResettable) {
        violations.push(k);
      }
    }
    expect(violations).toEqual([]);
  });

  it('RESETTABLE_DEFAULTS and NON_RESETTABLE_KEYS are disjoint', () => {
    const intersection: string[] = [];
    for (const k of Object.keys(RESETTABLE_DEFAULTS)) {
      if (NON_RESETTABLE_KEYS.has(k)) {
        intersection.push(k);
      }
    }
    expect(intersection).toEqual([]);
  });

  it('system_prompt is resettable and NOT in NON_RESETTABLE_KEYS', () => {
    expect(isResettable('system_prompt')).toBe(true);
    expect(NON_RESETTABLE_KEYS.has('system_prompt')).toBe(false);
  });

  it('every NON_RESETTABLE_KEYS key is NOT in RESETTABLE_DEFAULTS', () => {
    const violations: string[] = [];
    for (const k of NON_RESETTABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(RESETTABLE_DEFAULTS, k)) {
        violations.push(k);
      }
    }
    expect(violations).toEqual([]);
  });
});