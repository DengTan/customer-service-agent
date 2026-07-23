/**
 * Internal Knowledge Base Settings API Routes
 * GET /api/knowledge/internal/settings - Get internal KB settings
 * PUT /api/knowledge/internal/settings - Update internal KB settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, isDemoMode } from '@/storage/database/supabase-client';
import { requireRole, apiError, HttpStatus, getOrCreateRequestId, REQUEST_ID_HEADER } from '@/lib/api-utils';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { logger } from '@/lib/logger';
import {
  invalidateKnowledgeSearchSettingsCache,
} from '@/server/services/knowledge-search-service';
import {
  getHybridSearchService,
  invalidateSearchModeCache,
} from '@/server/services/hybrid-search-service';

// ─── Constants ─────────────────────────────────────────────────

const HYBRID_CONFIG_KEY = 'retrieval_hybrid_config';

const SEARCH_MODE_OPTIONS = ['embedding', 'hybrid'] as const;
type SearchMode = typeof SEARCH_MODE_OPTIONS[number];

// ─── DTO Types ────────────────────────────────────────────────

export interface InternalKnowledgeSettings {
  /** Search mode: vector-only or hybrid (vector + BM25 + RRF) */
  searchMode: SearchMode;
  /** Vector weight in hybrid mode (0-1) */
  vectorWeight: number;
  /** BM25 weight in hybrid mode (0-1) */
  bm25Weight: number;
  /** Rerank enabled */
  rerankEnabled: boolean;
  /** Rerank top N */
  rerankTopN: number;
  /** Rerank model: bge | cohere | mock */
  rerankModel: string;
  /** Top K for vector search */
  vectorTopK: number;
  /** Top K for BM25 search */
  bm25TopK: number;
  /** RRF k parameter */
  rrfK: number;
  /** Minimum score threshold */
  minScoreThreshold: number;
  /** Search result limit */
  searchLimit: number;
  /** Image search limit */
  imageSearchLimit: number;
  /** Max image citations per response */
  imageMaxCitations: number;
}

export interface InternalKnowledgeSettingsInput {
  searchMode?: SearchMode;
  vectorWeight?: number;
  bm25Weight?: number;
  rerankEnabled?: boolean;
  rerankTopN?: number;
  rerankModel?: string;
  vectorTopK?: number;
  bm25TopK?: number;
  rrfK?: number;
  minScoreThreshold?: number;
  searchLimit?: number;
  imageSearchLimit?: number;
  imageMaxCitations?: number;
}

// ─── Defaults ─────────────────────────────────────────────────

const DEFAULT_SETTINGS: InternalKnowledgeSettings = {
  searchMode: 'hybrid',
  vectorWeight: 0.6,
  bm25Weight: 0.4,
  rerankEnabled: false,
  rerankTopN: 10,
  rerankModel: 'mock',
  vectorTopK: 20,
  bm25TopK: 20,
  rrfK: 60,
  minScoreThreshold: 0.75,
  searchLimit: 5,
  imageSearchLimit: 3,
  imageMaxCitations: 9,
};

// ─── Validation ────────────────────────────────────────────────

const PutRequestSchema = z.object({
  searchMode: z.enum(SEARCH_MODE_OPTIONS).optional(),
  vectorWeight: z.number().min(0).max(1).optional(),
  bm25Weight: z.number().min(0).max(1).optional(),
  rerankEnabled: z.boolean().optional(),
  rerankTopN: z.number().int().min(1).max(100).optional(),
  rerankModel: z.string().optional(),
  vectorTopK: z.number().int().min(1).max(100).optional(),
  bm25TopK: z.number().int().min(1).max(100).optional(),
  rrfK: z.number().int().min(1).max(200).optional(),
  minScoreThreshold: z.number().min(0).max(1).optional(),
  searchLimit: z.number().int().min(1).max(50).optional(),
  imageSearchLimit: z.number().int().min(0).max(20).optional(),
  imageMaxCitations: z.number().int().min(0).max(20).optional(),
}).strict();

const ALLOWED_RERANK_MODELS = ['mock', 'bge', 'cohere', 'generic'] as const;

// ─── Helpers ──────────────────────────────────────────────────

/** Merge partial input with defaults and current stored values */
async function buildSettings(
  repo: SettingsRepository,
  input: Partial<InternalKnowledgeSettings>
): Promise<InternalKnowledgeSettings> {
  const hybridStr = await repo.get(HYBRID_CONFIG_KEY);
  let hybrid: Partial<InternalKnowledgeSettings> = {};
  if (hybridStr) {
    try {
      hybrid = JSON.parse(hybridStr);
    } catch {
      // ignore
    }
  }

  // Read search mode from dedicated key (set by internal KB settings page)
  const searchModeStr = await repo.get('retrieval_search_mode');
  const storedSearchMode = (searchModeStr === 'embedding' || searchModeStr === 'hybrid')
    ? searchModeStr
    : DEFAULT_SETTINGS.searchMode;

  // Also read individual settings
  const minScoreStr = await repo.get('knowledge_min_score');
  const searchLimitStr = await repo.get('knowledge_search_limit');
  const imageLimitStr = await repo.get('knowledge_image_search_limit');
  const imageCitationsStr = await repo.get('knowledge_image_max_citations');

  return {
    ...DEFAULT_SETTINGS,
    ...hybrid,
    ...input,
    searchMode: input.searchMode !== undefined ? input.searchMode : storedSearchMode,
    minScoreThreshold: input.minScoreThreshold !== undefined
      ? input.minScoreThreshold
      : (minScoreStr ? parseFloat(minScoreStr) : DEFAULT_SETTINGS.minScoreThreshold),
    searchLimit: input.searchLimit !== undefined
      ? input.searchLimit
      : (searchLimitStr ? parseInt(searchLimitStr, 10) : DEFAULT_SETTINGS.searchLimit),
    imageSearchLimit: input.imageSearchLimit !== undefined
      ? input.imageSearchLimit
      : (imageLimitStr ? parseInt(imageLimitStr, 10) : DEFAULT_SETTINGS.imageSearchLimit),
    imageMaxCitations: input.imageMaxCitations !== undefined
      ? input.imageMaxCitations
      : (imageCitationsStr ? parseInt(imageCitationsStr, 10) : DEFAULT_SETTINGS.imageMaxCitations),
  };
}

// ─── Handlers ────────────────────────────────────────────────

/**
 * GET /api/knowledge/internal/settings
 * Returns current internal KB settings (passwords masked).
 */
export async function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  try {
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    if (isDemoMode()) {
      return NextResponse.json(DEFAULT_SETTINGS, {
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    }

    const client = getServiceRoleClient();
    const repo = new SettingsRepository(client);
    const settings = await buildSettings(repo, {});

    return NextResponse.json(settings, { headers: { [REQUEST_ID_HEADER]: requestId } });
  } catch (err) {
    logger.error('[InternalKnowledgeSettings] GET failed', {
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
 * PUT /api/knowledge/internal/settings
 * Updates internal KB settings. Persists hybrid config as JSON + individual
 * threshold settings.
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

    const parsed = PutRequestSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return apiError(firstIssue.message || '请求参数无效', {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        meta: { errors: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      });
    }

    const input: InternalKnowledgeSettingsInput = parsed.data;

    if (input.rerankModel && !ALLOWED_RERANK_MODELS.includes(input.rerankModel as typeof ALLOWED_RERANK_MODELS[number])) {
      return apiError('不支持的重排序模型', {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_RERANK_MODEL',
      });
    }

    if (input.vectorWeight !== undefined && input.bm25Weight !== undefined) {
      if (Math.abs(input.vectorWeight + input.bm25Weight - 1) > 0.01) {
        return apiError('向量权重和 BM25 权重之和必须等于 1', {
          status: HttpStatus.BAD_REQUEST,
          code: 'INVALID_WEIGHT_SUM',
        });
      }
    }

    if (isDemoMode()) {
      return NextResponse.json({ success: true, demo: true }, {
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    }

    const client = getServiceRoleClient();
    const repo = new SettingsRepository(client);

    // Build hybrid config subset
    const hybridInput: Partial<InternalKnowledgeSettings> = {};
    if (input.searchMode !== undefined) hybridInput.searchMode = input.searchMode;
    if (input.vectorWeight !== undefined) hybridInput.vectorWeight = input.vectorWeight;
    if (input.bm25Weight !== undefined) hybridInput.bm25Weight = input.bm25Weight;
    if (input.rerankEnabled !== undefined) hybridInput.rerankEnabled = input.rerankEnabled;
    if (input.rerankTopN !== undefined) hybridInput.rerankTopN = input.rerankTopN;
    if (input.rerankModel !== undefined) hybridInput.rerankModel = input.rerankModel;
    if (input.vectorTopK !== undefined) hybridInput.vectorTopK = input.vectorTopK;
    if (input.bm25TopK !== undefined) hybridInput.bm25TopK = input.bm25TopK;
    if (input.rrfK !== undefined) hybridInput.rrfK = input.rrfK;

    // Merge with existing hybrid config
    const existingStr = await repo.get(HYBRID_CONFIG_KEY);
    let existing: Record<string, unknown> = {};
    if (existingStr) {
      try { existing = JSON.parse(existingStr); } catch { /* ignore */ }
    }
    const mergedHybrid = { ...existing, ...hybridInput };

    const updates: Record<string, string> = {
      [HYBRID_CONFIG_KEY]: JSON.stringify(mergedHybrid),
    };

    // Individual threshold settings
    if (input.minScoreThreshold !== undefined) {
      updates['knowledge_min_score'] = String(input.minScoreThreshold);
    }
    if (input.searchLimit !== undefined) {
      updates['knowledge_search_limit'] = String(input.searchLimit);
    }
    if (input.imageSearchLimit !== undefined) {
      updates['knowledge_image_search_limit'] = String(input.imageSearchLimit);
    }
    if (input.imageMaxCitations !== undefined) {
      updates['knowledge_image_max_citations'] = String(input.imageMaxCitations);
    }

    // Search mode stored as separate key for RetrievalOrchestrator to read
    if (input.searchMode !== undefined) {
      updates['retrieval_search_mode'] = input.searchMode;
    }

    if (Object.keys(updates).length > 0) {
      await repo.upsertMany(updates);
    }

    // Invalidate caches so new values take effect immediately
    invalidateKnowledgeSearchSettingsCache();
    // Invalidate search mode cache so RetrievalOrchestrator picks up the new value
    invalidateSearchModeCache();
    try {
      const hybridService = await getHybridSearchService();
      if (hybridService && typeof hybridService.loadConfig === 'function') {
        await hybridService.loadConfig();
      }
    } catch {
      // Non-fatal: HybridSearchService may not be initialized yet
    }

    return NextResponse.json({ success: true }, { headers: { [REQUEST_ID_HEADER]: requestId } });
  } catch (err) {
    logger.error('[InternalKnowledgeSettings] PUT failed', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError('保存设置失败', {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'SAVE_FAILED',
    });
  }
}
