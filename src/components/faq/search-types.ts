/**
 * Unified search types for FAQ search panels.
 * All SearchResult and SearchResultsData definitions should be imported from here
 * to avoid duplicate definitions that can drift over time.
 */

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  name?: string;
  category?: string;
  source?: string;
  filterReason?: string;
  isFiltered?: boolean;
}

export interface FilteredResult extends SearchResult {
  filterReason: string;
  isFiltered: true;
}

export interface SearchResultsData {
  results: SearchResult[];
  total: number;
  execution_time_ms: number;
  vector_results?: number;
  bm25_results?: number;
  rerank_requested?: boolean;
  rerank_applied?: boolean;
  rerank_backend?: 'bge' | 'cohere' | 'generic' | 'mock' | 'none';
  rerank_degraded?: boolean;
  avg_score?: number;
  error?: string;
  filtered?: {
    total: number;
    items: SearchResult[];
  };
  termAnalysis?: {
    queryTerms: string[];
    matchedTerms: string[];
    unmatchedTerms: string[];
  };
}
