import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock isDemoMode so the service exercises the non-demo path (no Supabase)
vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { SettingsService } from '@/server/services/settings-service';

describe('SettingsService.getSettingsMap — sensitive redaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the full map for admin callers (no key redaction)', async () => {
    const fakeRepo = {
      list: async () => [
        { key: 'theme', value: 'light' },
        { key: 'gorgias_api_key', value: 'sk-very-secret' },
        { key: 'system_prompt', value: 'You are a helpful assistant.' },
      ],
    };
    const svc = new SettingsService(fakeRepo as never);

    const result = await svc.getSettingsMap(true);

    expect(result).toEqual({
      theme: 'light',
      gorgias_api_key: 'sk-very-secret',
      system_prompt: 'You are a helpful assistant.',
    });
  });

  it('strips API keys, secrets, tokens, passwords, webhook secrets for non-admin callers', async () => {
    const fakeRepo = {
      list: async () => [
        { key: 'theme', value: 'light' },
        { key: 'gorgias_api_key', value: 'sk-very-secret' },
        { key: 'gorgias_email', value: 'admin@example.com' },
        { key: 'gorgias_webhook_secret', value: 'whsec_xxx' },
        { key: 'push_webhook_secret', value: 'whsec_yyy' },
        { key: 'llm_provider_api_key', value: 'llm-secret' },
        { key: 'llm_provider_bearer_token', value: 'tok-123' },
        { key: 'openai_api_key', value: 'openai-123' },
        { key: 'anthropic_api_key', value: 'claude-123' },
        { key: 'coze_api_key', value: 'coze-123' },
        { key: 'webhook_secret', value: 'plain-webhook-secret' },
      ],
    };
    const svc = new SettingsService(fakeRepo as never);

    const result = await svc.getSettingsMap(false);

    expect(result).toEqual({ theme: 'light' });
    // Specifically ensure none of the secret keys leaked through
    expect(Object.keys(result)).not.toContain('gorgias_api_key');
    expect(Object.keys(result)).not.toContain('gorgias_email');
    expect(Object.keys(result)).not.toContain('gorgias_webhook_secret');
    expect(Object.keys(result)).not.toContain('push_webhook_secret');
    expect(Object.keys(result)).not.toContain('llm_provider_api_key');
    expect(Object.keys(result)).not.toContain('llm_provider_bearer_token');
    expect(Object.keys(result)).not.toContain('openai_api_key');
    expect(Object.keys(result)).not.toContain('anthropic_api_key');
    expect(Object.keys(result)).not.toContain('coze_api_key');
    expect(Object.keys(result)).not.toContain('webhook_secret');
  });

  it('strips system_prompt for non-admin callers (only admins may view/edit)', async () => {
    const fakeRepo = {
      list: async () => [
        { key: 'theme', value: 'light' },
        { key: 'system_prompt', value: 'You are a helpful assistant.' },
      ],
    };
    const svc = new SettingsService(fakeRepo as never);

    const result = await svc.getSettingsMap(false);

    expect(result).toEqual({ theme: 'light' });
    expect(result).not.toHaveProperty('system_prompt');
  });
});

describe('SettingsService.validateSettings — allowlist + per-key type rules', () => {
  it('accepts every key the real settings UI submits', () => {
    const realPayload: Record<string, string> = {
      welcome_message: 'hi',
      session_timeout: '30',
      max_turns: '20',
      rating_enabled: 'true',
      new_conversation_notify: 'false',
      unhandled_remind_enabled: 'true',
      unhandled_remind_minutes: '30',
      alert_confidence_threshold: '0.4',
      alert_confidence_critical_threshold: '0.2',
      alert_high_rounds_threshold: '10',
      alert_high_rounds_critical_threshold: '15',
      alert_auto_handoff_rounds: '6',
      ai_model_enabled: 'true',
      ai_model: 'doubao-seed-2-0-lite-260215',
      llm_provider_id: 'coze',
      multimodal_enabled: 'true',
      multimodal_model: 'doubao-seed-2-0-pro-260215',
      multimodal_disabled_action: 'fixed_message',
      multimodal_fixed_message: 'fallback message',
      ai_temperature: '0.7',
      ai_max_tokens: '2048',
      ai_max_concurrent: '0',
      knowledge_min_score: '0.75',
      knowledge_search_limit: '5',
      knowledge_image_search_limit: '3',
      knowledge_smart_chunking_enabled: 'true',
      knowledge_chunk_size: '500',
      knowledge_chunk_overlap: '50',
      content_filter_enabled: 'true',
      sensitive_word_filter_enabled: 'true',
      url_filter_enabled: 'true',
      url_filter_mode: 'whitelist',
      sensitive_word_default_action: 'block',
      sensitive_word_block_message: 'blocked',
      sensitive_word_warn_message: 'warned',
      url_block_message: 'blocked url',
      knowledge_learning_confidence_threshold: '0.85',
      knowledge_learning_scan_interval_hours: '24',
      knowledge_learning_auto_scan_enabled: 'false',
      theme: 'system',
      font_size: '14',
      show_timestamps: 'true',
      compact_mode: 'false',
      max_main_bots: '10',
      custom_tools: '[{"value":"my_tool"}]',
    };
    const result = SettingsService.validateSettings(realPayload);
    expect(result.valid).toBe(true);
    expect(result.invalidKeys).toEqual([]);
    expect(result.invalidValues).toEqual([]);
  });

  it('rejects unknown keys (no silent acceptance)', () => {
    const result = SettingsService.validateSettings({
      system_prompt: 'malicious overwrite attempt',
      gorgias_api_key: 'sk-evil',
      rogue_key: 'value',
    });
    expect(result.valid).toBe(false);
    expect(result.invalidKeys).toEqual(
      expect.arrayContaining(['system_prompt', 'gorgias_api_key', 'rogue_key'])
    );
    expect(result.filtered).not.toHaveProperty('system_prompt');
    expect(result.filtered).not.toHaveProperty('gorgias_api_key');
    expect(result.filtered).not.toHaveProperty('rogue_key');
  });

  it('rejects out-of-range numeric keys (negative thresholds, NaN)', () => {
    const result = SettingsService.validateSettings({
      alert_confidence_threshold: '-1',
      alert_high_rounds_threshold: 'not-a-number',
    });
    expect(result.valid).toBe(false);
    expect(result.invalidValues.map(v => v.key)).toEqual(
      expect.arrayContaining(['alert_confidence_threshold', 'alert_high_rounds_threshold'])
    );
  });

  it('rejects values that exceed maximum length', () => {
    const result = SettingsService.validateSettings({
      welcome_message: 'x'.repeat(20_000),
    });
    expect(result.valid).toBe(false);
    expect(result.invalidValues[0]?.key).toBe('welcome_message');
  });
});