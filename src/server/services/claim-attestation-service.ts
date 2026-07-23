/**
 * P3 Phase 3 — Claim Attestation Service.
 *
 * Persists ClaimVerificationResult as claim_attestations rows.
 * Provides fire-and-forget persistence (errors are swallowed).
 */

import type { ClaimVerificationResult } from './claim-support-verifier';
import type { ClaimAttestationContext } from './claim-support-verifier';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

export interface ClaimAttestationRow {
  id: string;
  message_id: string;
  conversation_id: string;
  span: string;
  claim_text: string;
  verified: boolean;
  support_level: string;
  supported_chunk_ids: string[];
  verified_chunk_count: number;
  unsupported_reasons: string[];
  model_version: string | null;
  execution_time_ms: number;
  attribution_map: Record<string, string>;
  created_at: string;
}

export interface PersistAttestationParams {
  messageId: string;
  conversationId: string;
  span: string;
  verificationResult: ClaimVerificationResult;
  context?: ClaimAttestationContext;
}

export class ClaimAttestationService {
  /**
   * Persist a claim attestation as a claim_attestations row (fire-and-forget).
   * Errors are swallowed — attestation failure must never block SSE streaming.
   */
  persist(row: PersistAttestationParams): void {
    this.persistAsync(row).catch((err) => {
      logger.api.warn('claim-attestation-persist-failed', {
        error: err instanceof Error ? err.message : String(err),
        messageId: row.messageId,
        conversationId: row.conversationId,
      });
    });
  }

  private async persistAsync(row: PersistAttestationParams): Promise<void> {
    if (!row.messageId || row.messageId.startsWith('pending-')) return;
    const client = getSupabaseClient();
    const { error } = await client.from('claim_attestations').insert({
      message_id: row.messageId,
      conversation_id: row.conversationId,
      span: row.span,
      claim_text: (row.verificationResult.claims?.[0]?.text ?? ''),
      verified: row.verificationResult.ok,
      support_level: row.verificationResult.supportLevel ?? 'full',
      supported_chunk_ids: (row.verificationResult.sources ?? []).map((s) => (s as { chunk_id?: string }).chunk_id ?? '').filter(Boolean),
      verified_chunk_count: row.verificationResult.sources?.length ?? 0,
      unsupported_reasons: (row.verificationResult.code && !row.verificationResult.ok)
        ? [row.verificationResult.code]
        : [],
      model_version: row.context?.modelVersion ?? null,
      execution_time_ms: 0,
      attribution_map: {},
    });
    if (error) throw error;
  }

  /**
   * Get attestations for a message.
   */
  async getByMessageId(messageId: string): Promise<ClaimAttestationRow[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('claim_attestations')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data as ClaimAttestationRow[];
  }
}
