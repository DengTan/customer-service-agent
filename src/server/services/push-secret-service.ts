import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface PushSecretRotationResult {
  last4: string;
  rotated_at: string;
}

type SecretGenerator = () => string;

export class PushSecretService {
  constructor(
    private readonly client: SupabaseClient = getSupabaseClient(),
    private readonly generateSecret: SecretGenerator = () => randomBytes(32).toString('base64url'),
  ) {}

  async rotate(): Promise<PushSecretRotationResult> {
    const secret = this.generateSecret();
    if (typeof secret !== 'string' || secret.length < 43) {
      throw new Error('Generated webhook secret must be at least 43 characters');
    }

    const { data, error } = await this.client.rpc('rotate_push_webhook_secret', {
      p_new_value: secret,
    });
    if (error) {
      throw new Error(`Failed to rotate push webhook secret: ${error.message}`);
    }
    if (typeof data !== 'string' || !data) {
      throw new Error('Push webhook secret rotation returned no timestamp');
    }

    return { last4: secret.slice(-4), rotated_at: data };
  }
}
