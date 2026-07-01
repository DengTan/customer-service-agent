import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { KnowledgeSearchService } from './knowledge-search-service';

export interface QATestCase {
  id: string;
  question: string;
  expectedAnswer?: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  testSet: string;
  metadata?: Record<string, unknown>;
}

export interface EvaluationMetrics {
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  precisionAtK: number;
  queriesWithResults?: number;
  queriesWithoutResults?: number;
  avgExecutionTimeMs?: number;
}

export interface EvaluationResult {
  qaTestId: string;
  query: string;
  topK: number;
  metrics: EvaluationMetrics;
  queryResults: Array<{
    qaTestId: string;
    retrievedIds: string[];
    retrievedScores: number[];
    recallAtK: number;
    mrr: number;
    ndcgAtK: number;
    precisionAtK: number;
  }>;
}

export interface EvaluationConfig {
  topK: number;
  rerankEnabled: boolean;
  vectorWeight: number;
  bm25Weight: number;
}

/**
 * Retrieval Evaluation Service
 *
 * Implements the evaluation framework from the RAG document:
 * - Recall@K: Does the top-K contain the correct answer?
 * - MRR (Mean Reciprocal Rank): How high is the correct answer ranked?
 * - NDCG@K: Normalized Discounted Cumulative Gain
 * - Precision@K: What fraction of top-K is relevant?
 *
 * The evaluation uses a Q&A test set as ground truth.
 */
export class RetrievalEvalService {
  private searchService: KnowledgeSearchService;

  constructor() {
    this.searchService = new KnowledgeSearchService();
  }

  /**
   * Get all Q&A test cases, optionally filtered.
   */
  async getTestCases(options?: {
    category?: string;
    difficulty?: string;
    testSet?: string;
    limit?: number;
  }): Promise<QATestCase[]> {
    if (isDemoMode()) return [];

    const client = getSupabaseClient();
    let query = client.from('knowledge_qa_tests').select('*');

    if (options?.category) {
      query = query.eq('category', options.category);
    }
    if (options?.difficulty) {
      query = query.eq('difficulty', options.difficulty);
    }
    if (options?.testSet) {
      query = query.eq('test_set', options.testSet);
    }

    query = query.order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error || !data) {
      logger.agent.warn('[Eval] Failed to fetch test cases', { error });
      return [];
    }

    return data.map(row => ({
      id: row.id,
      question: row.question,
      expectedAnswer: row.expected_answer,
      category: row.category,
      difficulty: row.difficulty,
      testSet: row.test_set,
      metadata: row.metadata,
    }));
  }

  /**
   * Create a new Q&A test case.
   */
  async createTestCase(testCase: Omit<QATestCase, 'id'>): Promise<QATestCase | null> {
    if (isDemoMode()) return null;

    const client = getSupabaseClient();

    const { data, error } = await client
      .from('knowledge_qa_tests')
      .insert({
        question: testCase.question,
        expected_answer: testCase.expectedAnswer,
        category: testCase.category,
        difficulty: testCase.difficulty,
        test_set: testCase.testSet,
        metadata: testCase.metadata,
      })
      .select()
      .single();

    if (error || !data) {
      logger.agent.warn('[Eval] Failed to create test case', { error });
      return null;
    }

    return {
      id: data.id,
      question: data.question,
      expectedAnswer: data.expected_answer,
      category: data.category,
      difficulty: data.difficulty,
      testSet: data.test_set,
      metadata: data.metadata,
    };
  }

  /**
   * Delete a Q&A test case.
   */
  async deleteTestCase(id: string): Promise<boolean> {
    if (isDemoMode()) return false;

    const client = getSupabaseClient();
    const { error } = await client.from('knowledge_qa_tests').delete().eq('id', id);

    if (error) {
      logger.agent.warn('[Eval] Failed to delete test case', { error });
      return false;
    }

    return true;
  }

  /**
   * Run evaluation on a test set.
   * For each Q&A, retrieves top-K results and calculates metrics.
   */
  async runEvaluation(
    testCaseIds?: string[],
    config?: Partial<EvaluationConfig>
  ): Promise<EvaluationResult[]> {
    const topK = config?.topK || 5;

    // Get test cases
    let testCases = await this.getTestCases();
    if (testCaseIds && testCaseIds.length > 0) {
      testCases = testCases.filter(tc => testCaseIds.includes(tc.id));
    }

    if (testCases.length === 0) {
      logger.agent.warn('[Eval] No test cases found for evaluation');
      return [];
    }

    const results: EvaluationResult[] = [];
    let totalExecutionTime = 0;
    let queriesWithResults = 0;
    let queriesWithoutResults = 0;

    // Run evaluation for each test case
    for (const testCase of testCases) {
      const startTime = Date.now();

      // Search using hybrid search (if enabled) or regular search
      let searchResult;
      if (config?.rerankEnabled) {
        searchResult = await this.searchService.searchHybrid(testCase.question);
      } else {
        searchResult = await this.searchService.search(testCase.question);
      }

      const executionTimeMs = Date.now() - startTime;
      totalExecutionTime += executionTimeMs;

      if (searchResult.sources.length > 0) {
        queriesWithResults++;
      } else {
        queriesWithoutResults++;
      }

      // Calculate per-query metrics
      // Note: In a full implementation, ground truth would specify which knowledge items
      // should be retrieved. Here we use a heuristic based on content overlap.
      const queryMetrics = this.calculateQueryMetrics(
        testCase.question,
        searchResult.sources.map(s => ({
          id: s.knowledge_item_id || s.name || '',
          content: s.content,
          score: s.score,
        })),
        topK
      );

      // Log evaluation result
      await this.logEvaluationResult({
        qaTestId: testCase.id,
        query: testCase.question,
        topK,
        retrievedIds: searchResult.sources.map(s => s.knowledge_item_id || s.name || ''),
        retrievedScores: searchResult.sources.map(s => s.score),
        retrievedContents: searchResult.sources.map(s => s.content),
        ...queryMetrics,
        executionTimeMs,
        config: {
          rerankEnabled: config?.rerankEnabled ?? false,
          vectorWeight: config?.vectorWeight ?? 0.6,
          bm25Weight: config?.bm25Weight ?? 0.4,
        },
      });

      results.push({
        qaTestId: testCase.id,
        query: testCase.question,
        topK,
        metrics: queryMetrics,
        queryResults: [{
          qaTestId: testCase.id,
          retrievedIds: searchResult.sources.map(s => s.knowledge_item_id || s.name || ''),
          retrievedScores: searchResult.sources.map(s => s.score),
          ...queryMetrics,
        }],
      });
    }

    return results;
  }

  /**
   * Get aggregated evaluation metrics over all logged evaluations.
   */
  async getAggregatedMetrics(options?: {
    days?: number;
    configId?: string;
  }): Promise<EvaluationMetrics> {
    if (isDemoMode()) {
      return {
        recallAtK: 0,
        mrr: 0,
        ndcgAtK: 0,
        precisionAtK: 0,
        queriesWithResults: 0,
        queriesWithoutResults: 0,
        avgExecutionTimeMs: 0,
      };
    }

    const client = getSupabaseClient();
    const days = options?.days || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = client
      .from('retrieval_evaluation_logs')
      .select('recall_at_k, mrr, ndcg_at_k, precision_at_k, execution_time_ms')
      .gte('created_at', startDate.toISOString());

    if (options?.configId) {
      query = query.eq('config_id', options.configId);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return {
        recallAtK: 0,
        mrr: 0,
        ndcgAtK: 0,
        precisionAtK: 0,
        queriesWithResults: 0,
        queriesWithoutResults: 0,
        avgExecutionTimeMs: 0,
      };
    }

    const n = data.length;
    const avgRecall = data.reduce((sum, r) => sum + (r.recall_at_k || 0), 0) / n;
    const avgMrr = data.reduce((sum, r) => sum + (r.mrr || 0), 0) / n;
    const avgNdcg = data.reduce((sum, r) => sum + (r.ndcg_at_k || 0), 0) / n;
    const avgPrecision = data.reduce((sum, r) => sum + (r.precision_at_k || 0), 0) / n;
    const avgExecutionTime = data.reduce((sum, r) => sum + (r.execution_time_ms || 0), 0) / n;
    const queriesWithResults = data.filter(r => r.recall_at_k && r.recall_at_k > 0).length;

    return {
      recallAtK: Math.round(avgRecall * 1000) / 1000,
      mrr: Math.round(avgMrr * 1000) / 1000,
      ndcgAtK: Math.round(avgNdcg * 1000) / 1000,
      precisionAtK: Math.round(avgPrecision * 1000) / 1000,
      queriesWithResults,
      queriesWithoutResults: n - queriesWithResults,
      avgExecutionTimeMs: Math.round(avgExecutionTime),
    };
  }

  /**
   * Calculate metrics for a single query result.
   * Uses content overlap heuristic to determine relevance.
   */
  private calculateQueryMetrics(
    query: string,
    results: Array<{ id: string; content: string; score: number }>,
    topK: number
  ): Pick<EvaluationMetrics, 'recallAtK' | 'mrr' | 'ndcgAtK' | 'precisionAtK'> {
    if (results.length === 0) {
      return { recallAtK: 0, mrr: 0, ndcgAtK: 0, precisionAtK: 0 };
    }

    const relevantCount = results.filter(r => this.isRelevant(query, r.content)).length;
    const topKCount = Math.min(results.length, topK);

    // Recall@K: Fraction of top-K results that are relevant
    // (normalized by topK since total relevant docs in corpus is unknown)
    const recallAtK = topKCount > 0 ? relevantCount / topKCount : 0;

    // MRR: Reciprocal rank of first relevant document
    let mrr = 0;
    for (let i = 0; i < Math.min(results.length, topK); i++) {
      if (this.isRelevant(query, results[i].content)) {
        mrr = 1 / (i + 1);
        break;
      }
    }

    // NDCG@K: Normalized Discounted Cumulative Gain
    let dcg = 0;
    for (let i = 0; i < Math.min(results.length, topK); i++) {
      const relevance = this.isRelevant(query, results[i].content) ? 1 : 0;
      dcg += relevance / Math.log2(i + 2); // i+2 because log2(1) = 0
    }

    // Ideal DCG (top-K relevant documents sorted by ideal position)
    const totalRelevant = relevantCount;
    const idealDcg = Array.from({ length: topKCount }, (_, i) => {
      return i < totalRelevant ? 1 / Math.log2(i + 2) : 0;
    }).reduce((sum, v) => sum + v, 0);

    const ndcgAtK = idealDcg > 0 ? dcg / idealDcg : 0;

    // Precision@K: Fraction of top-K that is relevant
    const precisionAtK = topKCount > 0 ? relevantCount / topKCount : 0;

    return {
      recallAtK: Math.round(recallAtK * 1000) / 1000,
      mrr: Math.round(mrr * 1000) / 1000,
      ndcgAtK: Math.round(ndcgAtK * 1000) / 1000,
      precisionAtK: Math.round(precisionAtK * 1000) / 1000,
    };
  }

  /**
   * Heuristic relevance check based on keyword overlap.
   * In a full implementation, this would use ground truth labels.
   */
  private isRelevant(query: string, content: string): boolean {
    // Extract key terms from query
    const queryTerms = new Set(
      query
        .toLowerCase()
        .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g)
        ?.map(t => t.toLowerCase()) || []
    );

    if (queryTerms.size === 0) return false;

    // Count how many query terms appear in content
    const contentLower = content.toLowerCase();
    let matches = 0;
    for (const term of queryTerms) {
      if (contentLower.includes(term)) {
        matches++;
      }
    }

    // Consider relevant if >50% of query terms appear
    return matches / queryTerms.size > 0.5;
  }

  /**
   * Log evaluation result to database.
   */
  private async logEvaluationResult(data: {
    qaTestId: string;
    query: string;
    topK: number;
    retrievedIds: string[];
    retrievedScores: number[];
    retrievedContents: string[];
    recallAtK: number;
    mrr: number;
    ndcgAtK: number;
    precisionAtK: number;
    executionTimeMs: number;
    config: Record<string, unknown>;
  }): Promise<void> {
    if (isDemoMode()) return;

    try {
      const client = getSupabaseClient();
      await client.from('retrieval_evaluation_logs').insert({
        qa_test_id: data.qaTestId,
        query: data.query,
        top_k: data.topK,
        retrieved_ids: data.retrievedIds,
        retrieved_scores: data.retrievedScores,
        retrieved_contents: data.retrievedContents,
        recall_at_k: data.recallAtK,
        mrr: data.mrr,
        ndcg_at_k: data.ndcgAtK,
        precision_at_k: data.precisionAtK,
        execution_time_ms: data.executionTimeMs,
        config_snapshot: data.config,
      });
    } catch (err) {
      logger.agent.warn('[Eval] Failed to log evaluation result', { error: err });
    }
  }
}

// Singleton instance
let evalServiceInstance: RetrievalEvalService | null = null;

export function getRetrievalEvalService(): RetrievalEvalService {
  if (!evalServiceInstance) {
    evalServiceInstance = new RetrievalEvalService();
  }
  return evalServiceInstance;
}
