/**
 * Unified entry point for the "test connection" admin routes.
 *
 * Both routes funnel through `runExternalKbTest`:
 *   - POST /api/knowledge/external/test-connection        → apiKey from request body (UI form)
 *   - POST /api/knowledge/external/test-connection/saved  → apiKey from encrypted settings storage
 *
 * Responsibilities (single source of truth, no per-route duplication):
 *   1. URL validation (delegated to ssrf-guard; also enforces HTTPS in production)
 *   2. datasetId format validation (MongoDB ObjectId hex 24)
 *   3. API key decryption (when supplied as an encrypted blob)
 *   4. Dispatch to provider-specific probe (currently FastGPT)
 */
import { validateExternalUrl } from '@/lib/security/ssrf-guard';
import { probeFastGPT } from './external-kb-probe';
import { decrypt, isEncrypted } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { EXTERNAL_KB } from '@/lib/constants';
import { FASTGPT_OBJECT_ID_REGEX } from '@/server/services/external-kb-probe';

export interface RunExternalKbTestOptions {
  provider: string;
  baseUrl: string;
  /** When `null`, the caller wants the service to load the key from settings. */
  apiKey: string | null;
  datasetId: string;
}

export interface ExternalKbTestResult {
  success: boolean;
  message: string;
  datasetFound?: boolean;
}

/**
 * Run an external KB connection test.
 *
 * The `apiKey: null` contract lets `saved/route.ts` delegate the "read from
 * settings, decrypt, and fail gracefully on corruption" logic to a single
 * place, so neither route has to implement it locally.
 */
export async function runExternalKbTest(opts: RunExternalKbTestOptions): Promise<ExternalKbTestResult> {
  const { provider, baseUrl, apiKey, datasetId } = opts;

  // ── URL validation (SSRF + HTTPS-in-prod) ─────────────────────────────
  const validation = validateExternalUrl(baseUrl, {
    requireHttps: process.env.NODE_ENV === 'production',
  });
  if (!validation.valid) {
    return { success: false, message: validation.error ?? 'URL validation failed' };
  }

  // ── datasetId format (provider-specific) ──────────────────────────────
  if (provider === 'fastgpt') {
    if (!FASTGPT_OBJECT_ID_REGEX.test(datasetId)) {
      return { success: false, message: 'datasetId format invalid (expected 24-char hex MongoDB ObjectId)' };
    }
  }

  // ── API key decryption (when a blob is supplied directly) ────────────
  let decryptedKey = apiKey ?? '';
  if (decryptedKey && isEncrypted(decryptedKey)) {
    try {
      decryptedKey = decrypt(decryptedKey);
    } catch (err) {
      logger.warn('Failed to decrypt API key in test', { error: err });
      return { success: false, message: 'API key decryption failed' };
    }
  }

  // ── Provider dispatch ────────────────────────────────────────────────
  if (provider === 'fastgpt') {
    return await probeFastGPT(baseUrl, decryptedKey, datasetId, {
      timeoutMs: EXTERNAL_KB.PROBE_TIMEOUT_MS,
    });
  }

  return { success: false, message: `Unsupported provider: ${provider}` };
}
