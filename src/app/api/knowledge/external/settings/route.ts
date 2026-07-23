/**
 * External Knowledge Settings API Routes
 * GET /api/knowledge/external/settings - 获取外部知识库配置
 * PUT /api/knowledge/external/settings - 更新外部知识库配置
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, isDemoMode } from '@/storage/database/supabase-client';
import { requireRole, apiError, HttpStatus, getOrCreateRequestId, REQUEST_ID_HEADER } from '@/lib/api-utils';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { logger } from '@/lib/logger';

// ─── DTO Types ────────────────────────────────────────────────

/** Provider whitelist */
const ALLOWED_PROVIDERS = ['fastgpt'] as const;

/** GET response shape */
export interface ExternalKnowledgeSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKeyMasked: string;
  datasetId: string;
  searchMode: 'embedding' | 'hybrid' | 'fullText';
  useRerank: boolean;
}

/** PUT request shape */
export interface ExternalKnowledgeSettingsInput {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  datasetId?: string;
  searchMode?: 'embedding' | 'hybrid' | 'fullText';
  useRerank?: boolean;
}

const ALLOWED_SEARCH_MODES = ['embedding', 'hybrid', 'fullText'] as const;

/**
 * Zod schema for PUT request body validation.
 * Custom error messages are mapped to codes in the handler.
 * enabled and provider are optional because users may only update partial fields like apiKey.
 */
const PutRequestSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.string().optional(),
  baseUrl: z.string().url().max(2048).optional(),
  apiKey: z.string().min(8, 'API Key 长度至少 8 个字符').optional(),
  datasetId: z.string().min(1).max(255).optional(),
  searchMode: z.enum(ALLOWED_SEARCH_MODES).optional(),
  useRerank: z.boolean().optional(),
}).strict(); // reject unknown keys

/** Message-to-code mapping for field validation */
const VALIDATION_CODE_MAP: Record<string, string> = {
  'Invalid type': 'VALIDATION_ERROR',
  'Required': 'MISSING_REQUIRED_FIELD',
};

/** Maps a Zod issue to an error code */
function mapIssueToCode(issue: z.ZodIssue): string {
  if (issue.code === 'custom') {
    const code = (issue as unknown as { errorCode?: string }).errorCode;
    if (code) return String(code);
  }
  const mapped = VALIDATION_CODE_MAP[issue.message];
  if (mapped) return mapped;

  switch (issue.path.join('.')) {
    case 'enabled': return 'INVALID_ENABLED';
    case 'provider': return 'INVALID_PROVIDER';
    case 'baseUrl': return 'INVALID_URL_FORMAT';
    case 'apiKey': return 'API_KEY_TOO_SHORT';
    case 'searchMode': return 'INVALID_SEARCH_MODE';
    case 'useRerank': return 'INVALID_USE_RERANK';
    default: return 'VALIDATION_ERROR';
  }
}

/** URL validator (allows http:// and https://, blocks SSRF targets). */
function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (isBlockedHostname(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Blocked hostnames and IP ranges for SSRF protection (shared with test-connection route). */
const SSRF_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
]);

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTNAMES.has(h)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;
  if (h === '::1' || h === 'fe80::1') return true;
  return false;
}

const SECRET_KEY = 'external_knowledge_api_key';

/**
 * GET /api/knowledge/external/settings
 * 获取外部知识库配置（API Key 脱敏处理）
 */
export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    if (isDemoMode()) {
      return NextResponse.json({
        enabled: false,
        provider: 'fastgpt',
        baseUrl: '',
        apiKeyMasked: '',
        datasetId: '',
        searchMode: 'embedding',
        useRerank: false,
      }, { headers: { [REQUEST_ID_HEADER]: requestId } });
    }

    const client = getServiceRoleClient();
    const repo = new SettingsRepository(client);
    const allSettings = await repo.list();
    const settings: Record<string, string> = {};
    for (const row of allSettings) {
      settings[row.key] = row.value;
    }

    const enabled = settings['external_knowledge_enabled'] === 'true';
    const provider = settings.external_knowledge_provider || 'fastgpt';
    const baseUrl = settings.external_knowledge_base_url || '';
    const apiKey = settings[SECRET_KEY] || '';
    const datasetId = settings.external_knowledge_dataset_id || '';
    const searchMode = (ALLOWED_SEARCH_MODES.includes(settings.external_knowledge_search_mode as typeof ALLOWED_SEARCH_MODES[number])
      ? settings.external_knowledge_search_mode
      : 'embedding') as 'embedding' | 'hybrid' | 'fullText';
    const useRerank = settings.external_knowledge_use_rerank === 'true';

    // Mask API key: show last 4 characters only
    const apiKeyMasked = apiKey.length > 4
      ? '****' + apiKey.slice(-4)
      : '';

    return NextResponse.json({
      enabled,
      provider,
      baseUrl,
      apiKeyMasked,
      datasetId,
      searchMode,
      useRerank,
    }, { headers: { [REQUEST_ID_HEADER]: requestId } });
  } catch (err) {
    logger.error('[ExternalKnowledgeSettings] GET failed', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError('加载设置失败', {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'FETCH_FAILED',
    });
  }
}

/**
 * PUT /api/knowledge/external/settings
 * 更新外部知识库配置
 */
export async function PUT(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('请求体 JSON 格式无效', {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_JSON',
      });
    }

    // Field-level validation with specific error codes
    const parsed = PutRequestSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const code = mapIssueToCode(firstIssue);

      return apiError(firstIssue.message || '请求参数无效', {
        status: HttpStatus.BAD_REQUEST,
        code,
        meta: { errors: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      });
    }

    const input: ExternalKnowledgeSettingsInput = parsed.data;

    // Additional semantic validations (not type-level)
    if (input.provider !== undefined && !ALLOWED_PROVIDERS.includes(input.provider as typeof ALLOWED_PROVIDERS[number])) {
      return apiError('不支持的知识库提供商', {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_PROVIDER',
      });
    }

    if (input.baseUrl !== undefined && input.baseUrl !== '' && !isValidUrl(input.baseUrl)) {
      return apiError('无效的 URL 格式', {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_URL_FORMAT',
      });
    }

    if (input.apiKey !== undefined && input.apiKey.length > 0 && input.apiKey.length < 8) {
      return apiError('API Key 长度至少 8 个字符', {
        status: HttpStatus.BAD_REQUEST,
        code: 'API_KEY_TOO_SHORT',
      });
    }

    if (isDemoMode()) {
      return NextResponse.json({ success: true, demo: true }, { headers: { [REQUEST_ID_HEADER]: requestId } });
    }

    const client = getServiceRoleClient();
    const repo = new SettingsRepository(client);

    // Build settings to update
    const updates: Record<string, string> = {};

    if (input.enabled !== undefined) {
      updates.external_knowledge_enabled = String(input.enabled);
    }
    if (input.provider !== undefined) {
      updates.external_knowledge_provider = input.provider;
    }
    if (input.baseUrl !== undefined) {
      updates.external_knowledge_base_url = input.baseUrl;
    }
    if (input.apiKey !== undefined) {
      // API key goes to the secret key
      updates[SECRET_KEY] = input.apiKey;
    }
    if (input.datasetId !== undefined) {
      updates.external_knowledge_dataset_id = input.datasetId;
    }
    if (input.searchMode !== undefined) {
      updates.external_knowledge_search_mode = input.searchMode;
    }
    if (input.useRerank !== undefined) {
      updates.external_knowledge_use_rerank = String(input.useRerank);
    }

    if (Object.keys(updates).length > 0) {
      await repo.upsertMany(updates);
    }

    return NextResponse.json({ success: true }, { headers: { [REQUEST_ID_HEADER]: requestId } });
  } catch (err) {
    logger.error('[ExternalKnowledgeSettings] PUT failed', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError('保存设置失败', {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'SAVE_FAILED',
    });
  }
}
