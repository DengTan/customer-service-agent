import { KnowledgeClient, Config } from 'coze-coding-dev-sdk';
import { toServiceError } from './service-utils';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { logger } from '@/lib/logger';

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
  name?: string;         // Knowledge item name
  category?: string;     // Knowledge item category
}

export interface KnowledgeSearchResult {
  context: string;
  sources: KnowledgeSourceItem[];
  confidence: number;
  images: KnowledgeImageRef[];
}

// Knowledge relevance threshold defaults (overridable via settings table)
// Keys: knowledge_min_score, knowledge_search_limit, knowledge_image_search_limit
const DEFAULT_KNOWLEDGE_MIN_SCORE = 0.75;
const DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 5;
const DEFAULT_KNOWLEDGE_IMAGE_SEARCH_LIMIT = 3;
const SEARCH_SETTINGS_TTL_MS = 30_000;

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
      const knowledgeConfig = new Config();
      const knowledgeClient = new KnowledgeClient(knowledgeConfig);

      // Strip tool call patterns from user input to prevent prompt injection
      const cleanQuery = this.stripToolCallPatterns(query);

      // Resolve effective thresholds: explicit args > settings table > defaults
      const settings = await getSearchSettings();
      const effectiveMinScore = minScore ?? settings.minScore;
      const effectiveLimit = limit ?? settings.searchLimit;

      const searchResult = await knowledgeClient.search(cleanQuery, undefined, effectiveLimit, effectiveMinScore);

      // Also look for associated images from knowledge items in parallel
      const imagePromise = this.searchRelatedImages(query);

      if (searchResult.code === 0 && searchResult.chunks && searchResult.chunks.length > 0) {
        // Filter by min_score threshold - only include high-relevance results
        const relevantChunks = searchResult.chunks.filter(chunk => chunk.score >= effectiveMinScore);

        if (relevantChunks.length > 0) {
          const context = relevantChunks
            .map((chunk, i) => `[资料${i + 1}] ${chunk.content}`)
            .join('\n\n');

          const sources: KnowledgeSourceItem[] = relevantChunks.map((chunk) => ({
            type: 'knowledge',
            content: chunk.content,
            score: chunk.score,
          }));

          // Enrich sources with knowledge item name/category from database
          try {
            const enrichedSources = await this.enrichSourcesWithMetadata(sources, query);
            sources.splice(0, sources.length, ...enrichedSources);
          } catch {
            // Metadata enrichment failure is non-critical; proceed with basic sources
          }

          // Average score of relevant results as confidence indicator
          const confidence = relevantChunks.reduce((sum, c) => sum + c.score, 0) / relevantChunks.length;

          // Get images related to the query
          const images = await imagePromise;

          return { context, sources, confidence, images };
        }
      }

      // No text results above threshold, but still check for images
      const images = await imagePromise;
      return { context: '', sources: [], confidence: 0, images };
    } catch (error) {
      // Knowledge base search failure should not block the main flow
      logger.agent.error('Knowledge search failed', { error });
      return { context: '', sources: [], confidence: 0, images: [] };
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
        .select('id, name, category, content')
        .eq('status', 'active')
        .or(orConditions)
        .limit(sources.length);

      if (error || !data || data.length === 0) return sources;

      const items = data as Array<{ id: string; name: string; category: string; content: string }>;

      // Track matched item IDs for hit_count update
      const matchedItemIds: Set<string> = new Set();

      // Match each source to the best knowledge item by content overlap
      const enrichedSources = sources.map(source => {
        let bestMatch: { id: string; name: string; category: string } | null = null;
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
            bestMatch = { id: item.id, name: item.name, category: item.category };
          }
        }

        if (bestMatch) {
          matchedItemIds.add(bestMatch.id);
          return { ...source, knowledge_item_id: bestMatch.id, name: bestMatch.name, category: bestMatch.category };
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
