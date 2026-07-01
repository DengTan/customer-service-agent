import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';

export interface Bm25Chunk {
  id: string;
  content: string;
  name: string;
  category: string;
  knowledge_item_id: string;
  chunk_index: number;
}

export interface Bm25Result {
  id: string;
  content: string;
  name: string;
  category: string;
  score: number;
  knowledge_item_id: string;
  chunk_index: number;
}

/**
 * Simple in-memory BM25 implementation for keyword search.
 * Documents are indexed from the knowledge_items table.
 * Tokenization: character-level n-grams for Chinese, whitespace split for English.
 */
export class Bm25SearchService {
  private documents: Bm25Chunk[] = [];
  private docLengths: number[] = [];
  private avgDocLength = 0;
  private termDocFreq: Map<string, number> = new Map();
  private termDocIds: Map<string, Set<number>> = new Map();
  private lastIndexedAt = 0;
  private buildingRef = false;

  // BM25 parameters
  private readonly k1 = 1.5;  // Term frequency saturation
  private readonly b = 0.75;  // Length normalization factor
  private readonly indexTtlMs = 30 * 60 * 1000; // Re-index every 30 minutes

  /**
   * Tokenize text into terms.
   * Chinese: character bigrams + trigrams for better coverage
   * English: lowercase words
   */
  private tokenize(text: string): string[] {
    if (!text) return [];

    const terms: Set<string> = new Set();

    // Extract Chinese character n-grams (bigrams and trigrams)
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    for (let i = 0; i < chineseChars.length - 1; i++) {
      terms.add(chineseChars[i]);
      if (i < chineseChars.length - 2) {
        terms.add(chineseChars[i] + chineseChars[i + 1]);
        terms.add(chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2]);
      }
    }

    // Extract English words
    const englishWords = text.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
    englishWords.forEach(w => terms.add(w));

    return [...terms];
  }

  /**
   * Build the in-memory inverted index from the knowledge_items and knowledge_chunks tables.
   * Since PostgREST may not have the relationship cached, we fetch both tables separately
   * and join them in memory.
   */
  async buildIndex(): Promise<void> {
    if (isDemoMode()) return;

    try {
      const client = getSupabaseClient();

      // Fetch all active knowledge items (without nested chunks query to avoid PostgREST schema cache issues)
      const { data: items, error: itemsError } = await client
        .from('knowledge_items')
        .select('id, name, content, category, status')
        .eq('status', 'active')
        .not('content', 'is', null);

      if (itemsError || !items || items.length === 0) {
        logger.agent.warn('[BM25] Failed to fetch knowledge items or no items found', { error: itemsError });
        return;
      }

      // Create a map of item_id -> item for quick lookup
      const itemMap = new Map(items.map(item => [item.id, item]));

      // Fetch all knowledge chunks
      const { data: chunks, error: chunksError } = await client
        .from('knowledge_chunks')
        .select('id, knowledge_item_id, chunk_index, content')
        .not('content', 'is', null);

      if (chunksError) {
        logger.agent.warn('[BM25] Failed to fetch chunks', { error: chunksError });
      }

      // Group chunks by knowledge_item_id
      const chunksByItemId = new Map<string, Array<{ id: string; chunk_index: number; content: string }>>();
      if (chunks && chunks.length > 0) {
        for (const chunk of chunks) {
          const existing = chunksByItemId.get(chunk.knowledge_item_id) || [];
          existing.push({
            id: chunk.id,
            chunk_index: chunk.chunk_index,
            content: chunk.content,
          });
          chunksByItemId.set(chunk.knowledge_item_id, existing);
        }
      }

      const docs: Bm25Chunk[] = [];
      let totalLen = 0;

      for (const item of items) {
        const itemChunks = chunksByItemId.get(item.id);

        if (itemChunks && itemChunks.length > 0) {
          // Use chunks if available
          for (const chunk of itemChunks) {
            if (chunk.content) {
              docs.push({
                id: chunk.id,
                content: chunk.content,
                name: item.name,
                category: item.category || '未分类',
                knowledge_item_id: item.id,
                chunk_index: chunk.chunk_index,
              });
              totalLen += chunk.content.length;
            }
          }
        } else if (item.content) {
          // Fallback to full content when no chunks
          docs.push({
            id: item.id,
            content: item.content,
            name: item.name,
            category: item.category || '未分类',
            knowledge_item_id: item.id,
            chunk_index: 0,
          });
          totalLen += item.content.length;
        }
      }

      // Build inverted index
      this.termDocFreq.clear();
      this.termDocIds.clear();

      for (let i = 0; i < docs.length; i++) {
        const terms = this.tokenize(docs[i].content);
        for (const term of terms) {
          this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
          if (!this.termDocIds.has(term)) {
            this.termDocIds.set(term, new Set());
          }
          this.termDocIds.get(term)!.add(i);
        }
      }

      this.documents = docs;
      this.docLengths = docs.map(d => d.content.length);
      this.avgDocLength = docs.length > 0 ? totalLen / docs.length : 1;
      this.lastIndexedAt = Date.now();

      logger.agent.info('[BM25] Index built', {
        docCount: docs.length,
        termCount: this.termDocFreq.size,
        avgDocLen: Math.round(this.avgDocLength),
        itemsCount: items.length,
        chunksCount: chunks?.length || 0,
      });
    } catch (err) {
      logger.agent.error('[BM25] Index build failed', { error: err });
    }
  }

  /**
   * Search using BM25 algorithm.
   * Returns top-K results sorted by relevance score.
   */
  search(query: string, topK = 20): Bm25Result[] {
    if (!query || this.documents.length === 0) return [];

    const terms = this.tokenize(query);
    if (terms.length === 0) return [];

    const n = this.documents.length;
    const docScores: Array<{ idx: number; score: number }> = [];

    for (let i = 0; i < n; i++) {
      let score = 0;
      const docTerms = this.tokenize(this.documents[i].content);

      for (const term of terms) {
        // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
        const df = this.termDocFreq.get(term) || 0;
        const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);

        // TF component: (k1 + 1) * tf / (k1 * (1 - b + b * docLen / avgDocLen) + tf)
        const tf = docTerms.filter(t => t === term).length;
        const tfComponent = ((this.k1 + 1) * tf) /
          (this.k1 * (1 - this.b + this.b * this.docLengths[i] / this.avgDocLength) + tf);

        score += idf * tfComponent;
      }

      if (score > 0) {
        docScores.push({ idx: i, score });
      }
    }

    // Sort by score descending and take top-K
    docScores.sort((a, b) => b.score - a.score);
    const topResults = docScores.slice(0, topK);

    // Normalize scores to 0-1 range
    const maxScore = topResults.length > 0 ? topResults[0].score : 1;

    return topResults.map(({ idx, score }) => ({
      ...this.documents[idx],
      score: maxScore > 0 ? score / maxScore : 0,
    }));
  }

  /**
   * Ensure the index is built and not stale.
   */
  async ensureIndex(): Promise<void> {
    if (
      this.documents.length === 0 ||
      Date.now() - this.lastIndexedAt > this.indexTtlMs
    ) {
      if (this.buildingRef) {
        return;
      }
      this.buildingRef = true;
      try {
        await this.buildIndex();
      } finally {
        this.buildingRef = false;
      }
    }
  }

  /**
   * Get index statistics.
   */
  getStats(): { docCount: number; termCount: number; lastIndexedAt: number; isStale: boolean } {
    return {
      docCount: this.documents.length,
      termCount: this.termDocFreq.size,
      lastIndexedAt: this.lastIndexedAt,
      isStale: Date.now() - this.lastIndexedAt > this.indexTtlMs,
    };
  }
}

// Singleton instance
let bm25ServiceInstance: Bm25SearchService | null = null;

export function getBm25Service(): Bm25SearchService {
  if (!bm25ServiceInstance) {
    bm25ServiceInstance = new Bm25SearchService();
  }
  return bm25ServiceInstance;
}
