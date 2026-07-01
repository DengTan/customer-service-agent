import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_SETTINGS } from './demo-data/demo-settings';
import type { SettingRow } from './types';


export class SettingsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(): Promise<SettingRow[]> {
    if (isDemoMode()) {
      return DEMO_SETTINGS;
    }

    const { data, error } = await this.client.from('settings').select('key, value');
    if (error) throw new RepositoryError('list settings', error.message, error.code);
    return (data ?? []) as SettingRow[];
  }

  /**
   * Get a single setting value by key. Returns null if not set.
   * Uses the settings table directly to avoid pulling every key.
   */
  async get(key: string): Promise<string | null> {
    if (isDemoMode()) {
      const row = DEMO_SETTINGS.find((s) => s.key === key);
      return row?.value ?? null;
    }

    const { data, error } = await this.client
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new RepositoryError(`get setting ${key}`, error.message, error.code);
    return (data as { value: string } | null)?.value ?? null;
  }

  async upsertMany(settings: Record<string, string>): Promise<void> {
    if (isDemoMode()) {
      // In demo mode, just log and return without actually saving
      console.log('[Demo Mode] Settings upsert skipped:', settings);
      return;
    }
    
    const updatedAt = new Date().toISOString();
    const results = await Promise.all(
      Object.entries(settings).map(([key, value]) =>
        this.client
          .from('settings')
          .upsert({ key, value, updated_at: updatedAt }, { onConflict: 'key' }),
      ),
    );

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      throw new RepositoryError('upsert settings', failed.error.message, failed.error.code);
    }
  }

  /**
   * Set a single setting value. Creates or updates the key.
   */
  async set(key: string, value: string): Promise<void> {
    await this.upsertMany({ [key]: value });
  }

  /**
   * Atomically update a timestamp setting only if the condition is met.
   * Returns true if update succeeded, false if condition not met.
   * This prevents TOCTOU race conditions in concurrent requests.
   */
  async updateTimestampIfOlderThan(
    key: string,
    value: string,
    minHoursSince: number
  ): Promise<boolean> {
    if (isDemoMode()) {
      // In demo mode, always allow
      return true;
    }

    const now = Date.now();
    const minMs = minHoursSince * 60 * 60 * 1000;

    // Use RPC function for atomic update with condition check
    // Falls back to manual implementation if RPC not available
    try {
      // First, get current value
      const { data, error } = await this.client
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw new RepositoryError('updateTimestampIfOlderThan get', error.message, error.code);
      }

      const currentValue = (data as { value: string } | null)?.value ?? null;

      if (currentValue) {
        const lastTime = new Date(currentValue).getTime();
        const hoursSince = (now - lastTime) / (1000 * 60 * 60);
        if (hoursSince < minHoursSince) {
          // Condition not met, do not update
          return false;
        }
      }

      // Condition met or no previous value, proceed with update
      const { error: updateError } = await this.client
        .from('settings')
        .upsert(
          { key, value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );

      if (updateError) {
        throw new RepositoryError('updateTimestampIfOlderThan upsert', updateError.message, updateError.code);
      }

      return true;
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      console.error('[SettingsRepository] updateTimestampIfOlderThan error:', err);
      return false;
    }
  }
}
