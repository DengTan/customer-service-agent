'use client';

export type TabType = 'knowledge' | 'learning' | 'products' | 'size_charts' | 'search_test';

export interface KnowledgeItem {
  id: string;
  name: string;
  type: string;
  content: string | null;
  category: string;
  parent_category?: string | null;
  chunk_count: number;
  hit_count: number;
  last_hit_at: string | null;
  image_url: string | null;
  adopted_count?: number;
  rejected_count?: number;
  archived_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CategoryOption {
  category: string;
  parent_category: string | null;
  count: number;
}

export interface ProductItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  parent_category: string | null;
  brand: string | null;
  price: number | null;
  original_price: number | null;
  specifications: Array<{ key: string; value: string }>;
  features: string[];
  description: string | null;
  usage_instructions: string | null;
  image_urls: string[];
  status: string;
  tags: string[];
  hit_count: number;
  last_hit_at: string | null;
  sync_source: string;
  created_at: string;
  updated_at: string | null;
}

export interface SizeChartItem {
  id: string;
  name: string;
  chart_type: string;
  category: string;
  sku: string | null;
  product_id: string | null;
  size_columns: Array<{ key: string; label: string }>;
  size_rows: Array<Record<string, string>>;
  recommend_params: {
    dimensions: Array<{
      key: string;
      label: string;
      unit: string;
      range: [number, number];
      required: boolean;
    }>;
  } | null;
  recommend_rules: string | null;
  description: string | null;
  image_url: string | null;
  status: string;
  hit_count: number;
  created_at: string;
}

export interface LearningItem {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  conversation_id: string | null;
  conversation_title: string | null;
  source_context: string | null;
  category: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
  knowledge_item_id: string | null;
  created_at: string;
}

export interface LearningStats {
  pendingCount: number;
  approvedWeekCount: number;
  rejectedWeekCount: number;
  coverage: number;
}

export interface ChunkItem {
  id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
}

export interface VersionItem {
  id: string;
  version_number: number;
  title: string;
  content: string;
  change_summary: string | null;
  created_at: string;
  creator_name: string | null;
}

export const FILE_TYPE_MAP: Record<string, string> = {
  text: '文本',
  url: 'URL',
  file: '文件',
  image: '图片',
};

export const FILE_EXTENSIONS_LABEL = '.xlsx、.xls、.csv、.pdf、.docx、.doc、.md、.txt、.jpg、.jpeg、.png、.gif、.webp';

export const CATEGORIES = [
  '产品相关',
  '物流相关',
  '售后相关',
  '支付相关',
  '优惠相关',
  '财务相关',
  '会员相关',
  '未分类',
];

export const LEARNING_CATEGORIES = CATEGORIES;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
