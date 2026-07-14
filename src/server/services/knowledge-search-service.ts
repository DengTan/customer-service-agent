import { getEmbeddingService } from './embedding-service';
import { toServiceError } from './service-utils';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { logger } from '@/lib/logger';
import { getHybridSearchService } from './hybrid-search-service';

/**
 * Escape special characters for PostgreSQL LIKE/ILIKE patterns.
 * Prevents SQL injection via % (match any chars) and _ (match single char) wildcards.
 */
function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, '\\\\$&');
}

export interface KnowledgeImageRef {
  url: string;
  name: string;
  category: string;
}

export interface KnowledgeSourceItem {
  type: string;
  content: string;       // Full original chunk text
  score: number;         // Relevance score
  knowledge_item_id?: string; // Knowledge item UUID (for citation feedback)
  name?: string;         // Knowledge item name (human-readable label)
  category?: string;     // Knowledge item category
  // P2: stable chunk identity (from RPC match_knowledge_items)
  chunk_id?: string | null;  // Chunk UUID (null when parent item matched)
  chunk_index?: number;     // Chunk position within parent (0 when parent matched)
  content_hash?: string | null; // SHA-256 content hash for citation stability
  // Friendly aliases used by the public /api/knowledge response.
  // They mirror knowledge_item_id/name so we don't break the existing API contract.
  id?: string;
  title?: string;
  image_url?: string | null;
}

export interface KnowledgeSearchResult {
  context: string;
  sources: KnowledgeSourceItem[];
  confidence: number;
  images: KnowledgeImageRef[];
}

// Extended result with hybrid search metadata
export interface KnowledgeSearchResultExt extends KnowledgeSearchResult {
  hybridMetadata?: {
    vectorResults: number;
    bm25Results: number;
    rerankApplied: boolean;
    rerankBackend?: 'bge' | 'cohere' | 'generic' | 'mock' | 'none';
    rerankDegraded?: boolean;
    executionTimeMs: number;
  };
}

// Knowledge relevance threshold defaults (overridable via settings table)
// Keys: knowledge_min_score, knowledge_search_limit, knowledge_image_search_limit
// P0: Align to HTTP.KNOWLEDGE_MIN_SCORE (0.75) — cosine similarity is model/corpus-dependent,
//     this is a calibrated emergency guard; full precision requires reranker + claim attribution.
const DEFAULT_KNOWLEDGE_MIN_SCORE = 0.75;
const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 5;
const DEFAULT_KNOWLEDGE_IMAGE_SEARCH_LIMIT = 3;
const SEARCH_SETTINGS_TTL_MS = 30_000;
const SEARCH_SETTINGS_MAX_CACHE_SIZE = 1; // singleton: always 0 or 1 entry, bounded by TTL

interface KnowledgeSearchSettings {
  minScore: number;
  searchLimit: number;
  imageSearchLimit: number;
  cachedAt: number;
}

let searchSettingsCache: KnowledgeSearchSettings | null = null;
const settingsRepository = new SettingsRepository();

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Read knowledge search thresholds from the settings table.
 * Cached for 30s to avoid an extra DB read on every message.
 */
async function getSearchSettings(): Promise<KnowledgeSearchSettings> {
  if (searchSettingsCache && Date.now() - searchSettingsCache.cachedAt < SEARCH_SETTINGS_TTL_MS) {
    return searchSettingsCache;
  }

  let minScore = DEFAULT_KNOWLEDGE_MIN_SCORE;
  let searchLimit = DEFAULT_KNOWLEDGE_SEARCH_LIMIT;
  let imageSearchLimit = DEFAULT_KNOWLEDGE_IMAGE_SEARCH_LIMIT;

  try {
    const minScoreStr = await settingsRepository.get('knowledge_min_score');
    const limitStr = await settingsRepository.get('knowledge_search_limit');
    const imgLimitStr = await settingsRepository.get('knowledge_image_search_limit');
    if (minScoreStr) minScore = clampFloat(parseFloat(minScoreStr), 0, 1, DEFAULT_KNOWLEDGE_MIN_SCORE);
    if (limitStr) searchLimit = clampInt(parseInt(limitStr, 10), 1, 20, DEFAULT_KNOWLEDGE_SEARCH_LIMIT);
    if (imgLimitStr) imageSearchLimit = clampInt(parseInt(imgLimitStr, 10), 0, 10, DEFAULT_KNOWLEDGE_IMAGE_SEARCH_LIMIT);
  } catch (err) {
    // Settings table read failure should never break search; keep defaults.
    logger.agent.warn('[KnowledgeSearch] Failed to read search settings, using defaults', { error: err });
  }

  searchSettingsCache = { minScore, searchLimit, imageSearchLimit, cachedAt: Date.now() };
  return searchSettingsCache;
}

/** Test/diagnostic helper: invalidate the search-settings cache. */
export function invalidateKnowledgeSearchSettingsCache(): void {
  searchSettingsCache = null;
}

// Tool call pattern for stripping from user input
const TOOL_CALL_PATTERN = /\[TOOL_CALL\](\w+)\|({[^}]*})\[\/TOOL_CALL\]/g;

export class KnowledgeSearchService {
  /**
   * Search the knowledge base for relevant information.
   * Returns context, sources, confidence, and associated images based on relevance scores.
   */
  async search(
    query: string,
    minScore?: number,
    limit?: number,
  ): Promise<KnowledgeSearchResult> {
    try {
      // Strip tool call patterns from user input to prevent prompt injection
      const cleanQuery = this.stripToolCallPatterns(query);

      // Resolve effective thresholds: explicit args > settings table > defaults
      const settings = await getSearchSettings();
      const effectiveMinScore = minScore ?? settings.minScore;
      const effectiveLimit = limit ?? settings.searchLimit;

      const embeddingService = getEmbeddingService();
      const queryEmbedding = await embeddingService.embed(cleanQuery);

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('match_knowledge_items', {
        p_query_embedding: queryEmbedding,
        p_match_threshold: effectiveMinScore,
        p_match_count: effectiveLimit,
      });

      if (error || !data || data.length === 0) {
        return { context: '', sources: [], confidence: 0, images: [] };
      }

      const results = data as Array<{
        knowledge_item_id: string;
        chunk_id: string | null;
        chunk_index: number;
        content_hash: string | null;
        content: string;
        name: string;
        category: string;
        similarity: number;
      }>;

      const context = results
        .map((r, i) => `[资料${i + 1}] ${r.content}`)
        .join('\n\n');

      const sources: KnowledgeSourceItem[] = results.map((r) => ({
        type: 'knowledge',
        content: r.content,
        score: r.similarity,
        knowledge_item_id: r.knowledge_item_id,
        chunk_id: r.chunk_id,
        chunk_index: r.chunk_index,
        content_hash: r.content_hash,
        name: r.name,
        category: r.category,
        id: r.knowledge_item_id,
        title: r.name,
      }));

      const confidence = results.reduce((sum, r) => sum + r.similarity, 0) / results.length;

      // Fire-and-forget: enrich metadata and search images asynchronously
      // These are non-critical operations that should not block the search response
      const matchedIds = results.map(r => r.knowledge_item_id).filter(Boolean);
      this.incrementHitCounts(matchedIds).catch(() => {});
      this.searchRelatedImages(query).catch((err) => {
        logger.agent.debug('[KnowledgeSearch] Image search failed', { error: err });
      });

      return { context, sources, confidence, images: [] };
    } catch (error) {
      // Knowledge base search failure should not block the main flow
      logger.agent.error('Knowledge search failed', { error });
      return { context: '', sources: [], confidence: 0, images: [] };
    }
  }

  /**
   * Hybrid search combining vector + BM25 + RRF + Rerank.
   * This provides better recall and precision than pure vector search.
   *
   * @param query - User query
   * @param minScore - Minimum relevance score (overrides settings)
   * @param limit - Maximum number of results (overrides settings)
   * @returns KnowledgeSearchResult with hybrid search metadata
   */
  async searchHybrid(
    query: string,
    minScore?: number,
    limit?: number,
  ): Promise<KnowledgeSearchResultExt> {
    try {
      // Get settings for defaults
      const settings = await getSearchSettings();
      const effectiveMinScore = minScore ?? settings.minScore;
      const effectiveLimit = limit ?? settings.searchLimit;

      // Perform hybrid search
      const hybridService = getHybridSearchService();
      const hybridResult = await hybridService.search(query, {
        limit: effectiveLimit,
        minScore: effectiveMinScore,
      });

      if (hybridResult.results.length > 0) {
        const context = hybridResult.results
          .map((r, i) => `[资料${i + 1}] ${r.content}`)
          .join('\n\n');

        const sources: KnowledgeSourceItem[] = hybridResult.results.map(r => ({
          type: 'knowledge',
          content: r.content,
          score: r.score,
          knowledge_item_id: r.id,
          // P2: propagate stable chunk identity from hybrid search
          chunk_id: r.chunkId ?? null,
          chunk_index: r.chunkIndex ?? 0,
          content_hash: r.contentHash ?? null,
          name: r.name,
          category: r.category,
          id: r.id,
          title: r.name,
        }));

        const confidence = hybridResult.results.reduce((sum, r) => sum + r.score, 0) / hybridResult.results.length;

        // Fire-and-forget: enrich metadata, hit count, and search images asynchronously
        // These are non-critical operations that should not block the search response
        this.enrichSourcesWithMetadata(sources, query).catch((err) => {
          logger.agent.debug('[KnowledgeSearch] Metadata enrichment failed', { error: err });
        });
        // P2: also fire-and-forget hit count increment (uses knowledge_item_id which is set above)
        const matchedIds = hybridResult.results.map(r => r.id).filter(Boolean);
        this.incrementHitCounts(matchedIds).catch(() => {});
        this.searchRelatedImages(query).catch((err) => {
          logger.agent.debug('[KnowledgeSearch] Image search failed', { error: err });
        });

        return {
          context,
          sources,
          confidence,
          images: [],
          hybridMetadata: {
            vectorResults: hybridResult.vectorResults,
            bm25Results: hybridResult.bm25Results,
            rerankApplied: hybridResult.rerankApplied,
            rerankBackend: hybridResult.rerankBackend,
            rerankDegraded: hybridResult.rerankDegraded,
            executionTimeMs: hybridResult.executionTimeMs,
          },
        };
      }

      return { context: '', sources: [], confidence: 0, images: [] };
    } catch (error) {
      logger.agent.error('Hybrid search failed, falling back to vector search', { error });
      // Fallback to regular search
      const result = await this.search(query, minScore, limit);
      return { ...result, hybridMetadata: undefined };
    }
  }

  /**
   * Search knowledge_items table for entries with image_url that match the query.
   * Uses keyword matching on name/content to find related images.
   */
  private async searchRelatedImages(query: string): Promise<KnowledgeImageRef[]> {
    if (isDemoMode()) return [];

    try {
      const { imageSearchLimit } = await getSearchSettings();
      const client = getSupabaseClient();
      const keywords = query
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(k => k.length >= 2)
        .slice(0, 5); // Max 5 keywords

      if (keywords.length === 0) return [];

      // Build OR conditions for keyword matching on name and content
      // Use escapeLikePattern to prevent SQL injection via LIKE wildcards
      const orConditions = keywords
        .flatMap(kw => [`name.ilike.%${escapeLikePattern(kw)}%`, `content.ilike.%${escapeLikePattern(kw)}%`])
        .join(',');

      const { data, error } = await client
        .from('knowledge_items')
        .select('name, category, image_url')
        .eq('status', 'active')
        .not('image_url', 'is', null)
        .or(orConditions)
        .limit(imageSearchLimit);

      if (error || !data) return [];

      return (data as Array<{ name: string; category: string; image_url: string }>)
        .filter(item => item.image_url)
        .map(item => ({
          url: item.image_url,
          name: item.name,
          category: item.category || '未分类',
        }));
    } catch (error) {
      logger.agent.warn('Knowledge image search failed', { error });
      return [];
    }
  }

  /**
   * Enrich source items with name and category from knowledge_items table.
   * Uses keyword matching to find the corresponding knowledge item for each chunk.
   * Also increments hit_count for matched items (citation tracking).
   */
  private async enrichSourcesWithMetadata(
    sources: KnowledgeSourceItem[],
    query: string,
  ): Promise<KnowledgeSourceItem[]> {
    if (isDemoMode() || sources.length === 0) return sources;

    try {
      const client = getSupabaseClient();
      const keywords = query
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(k => k.length >= 2)
        .slice(0, 5);

      if (keywords.length === 0) return sources;

      // Use escapeLikePattern to prevent SQL injection via LIKE wildcards
      const orConditions = keywords
        .flatMap(kw => [`name.ilike.%${escapeLikePattern(kw)}%`, `content.ilike.%${escapeLikePattern(kw)}%`])
        .join(',');

      const { data, error } = await client
        .from('knowledge_items')
        .select('id, name, category, content, image_url')
        .eq('status', 'active')
        .or(orConditions)
        .limit(sources.length);

      if (error || !data || data.length === 0) return sources;

      const items = data as Array<{ id: string; name: string; category: string; content: string; image_url: string | null }>;

      // Track matched item IDs for hit_count update
      const matchedItemIds: Set<string> = new Set();

      // Match each source to the best knowledge item by content overlap
      const enrichedSources = sources.map(source => {
        let bestMatch: { id: string; name: string; category: string; image_url: string | null } | null = null;
        let bestOverlap = 0;

        for (const item of items) {
          // Simple overlap: count how many characters of source content appear in item content
          const sourceSnippet = source.content.slice(0, 80);
          let overlap = 0;
          for (let i = 0; i < sourceSnippet.length - 3; i++) {
            if (item.content.includes(sourceSnippet.slice(i, i + 4))) {
              overlap++;
            }
          }
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestMatch = { id: item.id, name: item.name, category: item.category, image_url: item.image_url };
          }
        }

        if (bestMatch) {
          matchedItemIds.add(bestMatch.id);
          return {
            ...source,
            knowledge_item_id: bestMatch.id,
            name: bestMatch.name,
            category: bestMatch.category,
            id: bestMatch.id,
            title: bestMatch.name,
            image_url: bestMatch.image_url,
          };
        }
        return source;
      });

      // Update hit_count + last_hit_at for matched items (fire-and-forget)
      if (matchedItemIds.size > 0) {
        this.incrementHitCounts([...matchedItemIds]).catch(() => {
          // Hit count update failure is non-critical
        });
      }

      return enrichedSources;
    } catch {
      return sources;
    }
  }

  /**
   * Increment hit_count and update last_hit_at for knowledge items that were cited.
   * Uses batch query + batch update to avoid N+1 queries.
   */
  private async incrementHitCounts(itemIds: string[]): Promise<void> {
    try {
      const client = getSupabaseClient();
      const now = new Date().toISOString();

      // 1. Batch query all items at once
      const { data: items } = await client
        .from('knowledge_items')
        .select('id, hit_count')
        .in('id', itemIds);

      if (!items || items.length === 0) return;

      // 2. Build update map
      const updates: Array<{ id: string; hit_count: number; last_hit_at: string }> = [];
      for (const item of items) {
        updates.push({
          id: item.id,
          hit_count: (item.hit_count ?? 0) + 1,
          last_hit_at: now,
        });
      }

      // 3. Fire off all updates in parallel (fire-and-forget to maintain existing behavior)
      await Promise.allSettled(
        updates.map(update =>
          client
            .from('knowledge_items')
            .update({ hit_count: update.hit_count, last_hit_at: update.last_hit_at })
            .eq('id', update.id)
        )
      );
    } catch (error) {
      logger.agent.warn('Failed to update hit counts', { error });
    }
  }

  /**
   * Strip tool call patterns from text to prevent prompt injection attacks.
   * These patterns [TOOL_CALL]...[/TOOL_CALL] should only appear in LLM responses, not user input.
   */
  stripToolCallPatterns(text: string): string {
    return text.replace(TOOL_CALL_PATTERN, '[工具调用已过滤]');
  }

  /**
   * Get the configured minimum score threshold (async to read from settings table).
   */
  async getMinScore(): Promise<number> {
    const s = await getSearchSettings();
    return s.minScore;
  }

  /**
   * Get the configured search limit (async to read from settings table).
   */
  async getSearchLimit(): Promise<number> {
    const s = await getSearchSettings();
    return s.searchLimit;
  }

  /**
   * Get the configured image search limit (async to read from settings table).
   */
  async getImageSearchLimit(): Promise<number> {
    const s = await getSearchSettings();
    return s.imageSearchLimit;
  }
}

// Singleton instance
let knowledgeSearchServiceInstance: KnowledgeSearchService | null = null;

export function getKnowledgeSearchService(): KnowledgeSearchService {
  if (!knowledgeSearchServiceInstance) {
    knowledgeSearchServiceInstance = new KnowledgeSearchService();
  }
  return knowledgeSearchServiceInstance;
}
