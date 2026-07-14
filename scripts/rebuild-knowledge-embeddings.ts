/**
 * scripts/rebuild-knowledge-embeddings.ts
 *
 * 知识库向量重建脚本
 * 支持全量重建（knowledge_items + knowledge_chunks）、修复缺失向量、四象限 repair、chunks-only 调试模式。
 *
 * Mean Pooling 策略：item 级向量 = 所有生效 chunk 向量的算术平均
 * 检索仍走 chunks，不受 Mean Pooling 影响。
 *
 * CLI:
 *   pnpm tsx scripts/rebuild-knowledge-embeddings.ts \
 *     --mode=full|repair|chunks-only \
 *     --scope=knowledge|product|size-chart|all \
 *     [--dry-run] [--include-archived] [--include-inactive] \
 *     [--concurrency=5] [--page-size=50] [--model=mxbai-embed-large]
 */

import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getEmbeddingService } from '@/server/services/embedding-service';
import { ProductDetailRepository } from '@/server/repositories/product-detail-repository';
import { SizeChartRepository } from '@/server/repositories/size-chart-repository';
config({ path: resolve(process.cwd(), '.env') });

// ============================================================
// Types
// ============================================================

interface ItemWithChunks {
  id: string;
  name: string;
  type: string;
  content: string | null;
  content_hash: string | null;
  category: string;
  status: string;
  chunk_count: number;
  archived_at: string | null;
  chunks: ChunkRow[];
}

interface ChunkRow {
  id: string;
  knowledge_item_id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  version_added: number;
  version_removed: number | null;
}

interface RebuildOptions {
  mode: 'full' | 'repair' | 'chunks-only';
  scope: 'knowledge' | 'product' | 'size-chart' | 'all';
  dryRun: boolean;
  includeArchived: boolean;
  includeInactive: boolean;
  concurrency: number;
  pageSize: number;
  model?: string;
  resume: boolean;
}

interface ProgressTracker {
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}

// ============================================================
// Constants
// ============================================================

const PROGRESS_FILE = '.rebuild-progress.json';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_CONCURRENCY = 5;

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs(argv: string[]): RebuildOptions {
  const args: Record<string, string | boolean | number> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        args[key] = isNaN(Number(val)) ? val : Number(val);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = isNaN(Number(next)) ? next : Number(next);
          i++;
        } else {
          args[key] = true;
        }
      }
    }
  }

  const mode = (args.mode as string) || 'full';
  if (!['full', 'repair', 'chunks-only'].includes(mode)) {
    throw new Error(`Invalid --mode: ${mode}. Choose: full | repair | chunks-only`);
  }

  const scope = (args.scope as string) || 'knowledge';
  if (!['knowledge', 'product', 'size-chart', 'all'].includes(scope)) {
    throw new Error(`Invalid --scope: ${scope}. Choose: knowledge | product | size-chart | all`);
  }

  return {
    mode: mode as RebuildOptions['mode'],
    scope: scope as RebuildOptions['scope'],
    dryRun: Boolean(args['dry-run']),
    includeArchived: Boolean(args['include-archived']),
    includeInactive: Boolean(args['include-inactive']),
    concurrency: typeof args.concurrency === 'number' ? args.concurrency : DEFAULT_CONCURRENCY,
    pageSize: typeof args['page-size'] === 'number' ? args['page-size'] : DEFAULT_PAGE_SIZE,
    model: typeof args.model === 'string' ? args.model : undefined,
    resume: Boolean(args.resume),
  };
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Mean Pooling — 聚合多个 chunk 向量为单个 item 向量。
 * 过滤空数组，返回 null 表示无有效向量。
 */
function meanPooling(embeddings: number[][]): number[] | null {
  const valid = embeddings.filter(e => Array.isArray(e) && e.length > 0);
  if (valid.length === 0) return null;
  const dim = valid[0].length;
  const result = new Array<number>(dim).fill(0);
  for (const emb of valid) {
    for (let i = 0; i < dim; i++) result[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) result[i] /= valid.length;
  return result;
}

/**
 * 序列化向量为 JSON string 或 null。
 * 统一在脚本层做序列化，不依赖 repository 的不一致行为。
 */
function serializeEmbedding(emb: number[] | null): string | null {
  return emb ? JSON.stringify(emb) : null;
}

/**
 * 失败容忍的单条 embed — embedBatch 对单条失败是零容忍的。
 * 失败返回 null，不抛异常。
 */
async function embedTolerant(svc: Awaited<ReturnType<typeof getEmbeddingService>>, text: string): Promise<number[] | null> {
  try {
    return await svc.embed(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n  [WARN] embed failed: ${msg.slice(0, 120)}\n`);
    return null;
  }
}

/**
 * 进度报告（每 N 条打印一行进度）。
 */
function reportProgress(current: number, total: number, label = 'items'): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  process.stdout.write(`\r  Progress: ${current}/${total} (${pct}%) ${label} processed  `);
  if (current >= total) process.stdout.write('\n');
}

// ============================================================
// Pre-flight Checks
// ============================================================

async function runPreFlightChecks(svc: Awaited<ReturnType<typeof getEmbeddingService>>, options: RebuildOptions): Promise<number> {
  console.log('\n=== Pre-flight Checks ===\n');

  // 1. Ollama 连通性
  process.stdout.write('1. Ollama 连通性检查... ');
  const available = await svc.isAvailable();
  if (!available) {
    console.error('\n\n[FATAL] Ollama 不可用。请确保 ollama serve 已在运行。\n');
    process.exit(1);
  }
  console.log('OK');

  // 2. 维度校验
  process.stdout.write('2. Embedding 维度校验... ');
  const testEmbedding = await svc.embed('test');
  if (!testEmbedding || testEmbedding.length === 0) {
    console.error('\n\n[FATAL] Ollama 返回空向量。\n');
    process.exit(1);
  }
  console.log(`OK (dimension=${testEmbedding.length})`);

  // 3. 估算总量
  const client = getSupabaseClient();
  const estimates = await estimateTotals(client, options);
  console.log('\n3. 待处理记录估算：');
  if (estimates.knowledgeItems > 0) console.log(`   knowledge_items:  ${estimates.knowledgeItems} 条`);
  if (estimates.knowledgeChunks > 0) console.log(`   knowledge_chunks: ${estimates.knowledgeChunks} 条`);
  if (estimates.products > 0) console.log(`   product_details:  ${estimates.products} 条`);
  if (estimates.sizeCharts > 0) console.log(`   size_charts:     ${estimates.sizeCharts} 条`);

  const total = estimates.knowledgeItems + estimates.knowledgeChunks + estimates.products + estimates.sizeCharts;
  if (total === 0) {
    console.log('\n[INFO] 没有需要重建的记录。退出。\n');
    process.exit(0);
  }

  return total;
}

interface EstimateTotals {
  knowledgeItems: number;
  knowledgeChunks: number;
  products: number;
  sizeCharts: number;
}

async function estimateTotals(client: ReturnType<typeof getSupabaseClient>, options: RebuildOptions): Promise<EstimateTotals> {
  const result: EstimateTotals = { knowledgeItems: 0, knowledgeChunks: 0, products: 0, sizeCharts: 0 };

  if (options.scope === 'knowledge' || options.scope === 'all') {
    // knowledge_items
    let itemsQuery = client
      .from('knowledge_items')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'deleted');
    if (!options.includeArchived) {
      itemsQuery = itemsQuery.is('archived_at', null);
    }
    const { count: kiCount } = await itemsQuery;
    result.knowledgeItems = kiCount ?? 0;

    // knowledge_chunks
    let chunksQuery = client
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .is('version_removed', null);
    const { count: kcCount } = await chunksQuery;
    result.knowledgeChunks = kcCount ?? 0;
  }

  if (options.scope === 'product' || options.scope === 'all') {
    let query = client
      .from('product_details')
      .select('id', { count: 'exact', head: true });
    if (!options.includeInactive) {
      query = query.eq('status', 'on_sale');
    }
    const { count } = await query;
    result.products = count ?? 0;
  }

  if (options.scope === 'size-chart' || options.scope === 'all') {
    let query = client
      .from('size_charts')
      .select('id', { count: 'exact', head: true });
    if (!options.includeInactive) {
      query = query.eq('status', 'active');
    }
    const { count } = await query;
    result.sizeCharts = count ?? 0;
  }

  return result;
}

// ============================================================
// Data Fetching
// ============================================================

/**
 * 分页拉取 knowledge_items 及其生效 chunks。
 * 先批量查 items，再批量查 chunks，在内存中聚合。
 */
async function fetchItemsWithChunks(
  client: ReturnType<typeof getSupabaseClient>,
  offset: number,
  limit: number,
  options: RebuildOptions,
): Promise<ItemWithChunks[]> {
  // 1. 拉取 items
  let itemsQuery = client
    .from('knowledge_items')
    .select('id, name, type, content, content_hash, category, status, chunk_count, archived_at')
    .neq('status', 'deleted')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (!options.includeArchived) {
    itemsQuery = itemsQuery.is('archived_at', null);
  }

  const { data: itemsData, error: itemsErr } = await itemsQuery;
  if (itemsErr || !itemsData || itemsData.length === 0) return [];

  // 2. 批量拉取所有 item 的 chunks
  const itemIds = itemsData.map((i: Record<string, unknown>) => i.id as string);
  const { data: chunksData } = await client
    .from('knowledge_chunks')
    .select('id, knowledge_item_id, chunk_index, content, content_hash, version_added, version_removed')
    .in('knowledge_item_id', itemIds)
    .is('version_removed', null)
    .order('chunk_index', { ascending: true });

  const chunksByItem = new Map<string, ChunkRow[]>();
  if (chunksData) {
    for (const c of chunksData as ChunkRow[]) {
      if (!chunksByItem.has(c.knowledge_item_id)) {
        chunksByItem.set(c.knowledge_item_id, []);
      }
      chunksByItem.get(c.knowledge_item_id)!.push(c);
    }
  }

  // 3. 组装
  return (itemsData as Array<Record<string, unknown>>).map(item => ({
    id: item.id as string,
    name: (item.name || item.title || '未命名') as string,
    type: (item.type || 'text') as string,
    content: item.content as string | null,
    content_hash: item.content_hash as string | null,
    category: (item.category || '未分类') as string,
    status: item.status as string,
    chunk_count: (item.chunk_count as number) || 0,
    archived_at: (item.archived_at as string) || null,
    chunks: chunksByItem.get(item.id as string) || [],
  }));
}

/**
 * 统计 knowledge_items 总数（用于分页上限）。
 */
async function countKnowledgeItems(client: ReturnType<typeof getSupabaseClient>, options: RebuildOptions): Promise<number> {
  let query = client
    .from('knowledge_items')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'deleted');
  if (!options.includeArchived) {
    query = query.is('archived_at', null);
  }
  const { count } = await query;
  return count ?? 0;
}

// ============================================================
// Knowledge Items Rebuild
// ============================================================

/**
 * 四象限分类：
 *   A: 有 content、有 chunks（chunk_count > 0）→ full rebuild
 *   B: 有 content、无 chunks（chunk_count = 0）→ 直接 embed(content)
 *   C: 无 content（纯图片等）→ embedding = null，跳过
 *   D: content 为空字符串 → 同 C
 */
async function rebuildKnowledgeItems(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  options: RebuildOptions,
  startingOffset = 0,
): Promise<ProgressTracker> {
  const tracker: ProgressTracker = { processed: 0, succeeded: 0, skipped: 0, failed: 0, errors: [] };

  if (options.scope !== 'knowledge' && options.scope !== 'all') {
    console.log('\n[SKIP] knowledge scope not selected.\n');
    return tracker;
  }

  console.log('\n=== Rebuilding Knowledge Items ===\n');

  // 统计总数
  const totalItems = await countKnowledgeItems(client, options);
  console.log(`Total knowledge_items to process: ${totalItems}`);

  if (options.dryRun) {
    console.log('[DRY-RUN] Skipping actual rebuild.');
    return tracker;
  }

  let offset = startingOffset;
  const { pageSize, concurrency } = options;

  while (true) {
    const items = await fetchItemsWithChunks(client, offset, pageSize, options);
    if (items.length === 0) break;

    // 并发处理每条 item
    const batches: ItemWithChunks[][] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      batches.push(items.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(item => processKnowledgeItem(client, svc, item, options)),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const item = batch[i];
        tracker.processed++;

        if (result.status === 'fulfilled') {
          const { status: s } = result.value;
          if (s === 'success') tracker.succeeded++;
          else if (s === 'skipped') tracker.skipped++;
          else if (s === 'failed') tracker.failed++;
        } else {
          tracker.failed++;
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          tracker.errors.push({ id: item.id, reason });
        }

        // 每 10 条打印一行进度
        if (tracker.processed % 10 === 0) {
          reportProgress(tracker.processed, totalItems, 'knowledge_items');
        }
      }
    }

    offset += pageSize;
    if (offset >= totalItems) break;
  }

  reportProgress(totalItems, totalItems, 'knowledge_items');
  return tracker;
}

interface ProcessResult {
  status: 'success' | 'skipped' | 'failed';
  skipped?: boolean;
}

/**
 * 处理单条 knowledge_item。
 */
async function processKnowledgeItem(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  item: ItemWithChunks,
  options: RebuildOptions,
): Promise<ProcessResult> {
  const hasContent = Boolean(item.content && item.content.trim().length > 0);
  const hasChunks = item.chunks.length > 0;

  // chunks-only 优先判断：只处理有 chunks 的 item，不依赖 hasContent
  if (options.mode === 'chunks-only') {
    // chunks-only 模式：只 embed chunks，不算 Mean Pooling，不受 hasContent 限制
    return processChunksOnly(client, svc, item, options);
  }

  // 四象限判定（仅 repair / full 模式）
  if (!hasContent) {
    // 象限 C/D：无 content（纯图片等）
    return { status: 'skipped', skipped: true };
  }

  if (options.mode === 'repair') {
    // repair 模式：四象限处理
    return processRepairQuadrant(client, svc, item, options);
  }

  // full 模式：总是走象限 A（重建 chunks + Mean Pooling）
  return processQuadrantA(client, svc, item, options);
}

/**
 * 象限 A：有 content、有 chunks → 重建 chunks + Mean Pooling
 */
async function processQuadrantA(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  item: ItemWithChunks,
  options: RebuildOptions,
): Promise<ProcessResult> {
  if (item.chunks.length === 0) {
    // 降级到象限 B
    return processQuadrantB(client, svc, item, options);
  }

  try {
    // 1. 并发 embed 所有 chunks
    const chunkEmbedResults = await Promise.all(
      item.chunks.map(chunk => embedTolerant(svc, chunk.content)),
    );

    // 2. 更新 chunks.embedding（直接 raw update，跳过 insertChunks）
    const chunkUpdates: Promise<unknown>[] = [];
    for (let i = 0; i < item.chunks.length; i++) {
      const chunk = item.chunks[i];
      const emb = chunkEmbedResults[i];
      const serialized = serializeEmbedding(emb);
      chunkUpdates.push(
        client
          .from('knowledge_chunks')
          .update({ embedding: serialized })
          .eq('id', chunk.id)
          .then(({ error }: { error: unknown }) => {
            if (error) throw error;
          }),
      );
    }
    await Promise.all(chunkUpdates);

    // 3. Mean Pooling → 更新 knowledge_items.embedding
    const validEmbeddings = chunkEmbedResults.filter((e): e is number[] => e !== null);
    if (validEmbeddings.length === 0) {
      // 所有 chunks embed 全部失败，不是"跳过"而是"失败"
      const failedChunkIds = item.chunks.map(c => c.id);
      throw new Error(`All ${item.chunks.length} chunks failed to embed (item=${item.id}, chunk_ids=${JSON.stringify(failedChunkIds)})`);
    }

    const itemEmbedding = meanPooling(validEmbeddings);
    const serializedItemEmbedding = serializeEmbedding(itemEmbedding);

    const { error: updateErr } = await client
      .from('knowledge_items')
      .update({
        embedding: serializedItemEmbedding,
        chunk_count: validEmbeddings.length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    if (updateErr) throw updateErr;
    return { status: 'success' };
  } catch (err) {
    throw err;
  }
}

/**
 * 象限 B：有 content、无 chunks → 直接 embed(content)
 */
async function processQuadrantB(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  item: ItemWithChunks,
  _options: RebuildOptions,
): Promise<ProcessResult> {
  if (!item.content) return { status: 'skipped', skipped: true };

  const emb = await embedTolerant(svc, item.content);
  if (!emb) {
    throw new Error(`embed failed for content (item=${item.id}, content_len=${item.content.length})`);
  }

  const serialized = serializeEmbedding(emb);
  const { error } = await client
    .from('knowledge_items')
    .update({
      embedding: serialized,
      chunk_count: 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id);

  if (error) throw new Error(`DB update failed (item=${item.id}): ${error.message}`);
  return { status: 'success' };
}

/**
 * repair 模式四象限处理。
 */
async function processRepairQuadrant(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  item: ItemWithChunks,
  options: RebuildOptions,
): Promise<ProcessResult> {
  const hasContent = Boolean(item.content && item.content.trim().length > 0);
  const hasChunks = item.chunks.length > 0;

  if (!hasContent) {
    // 象限 C/D：无 content，跳过
    return { status: 'skipped', skipped: true };
  }

  if (hasChunks) {
    // 象限 A：有 content、有 chunks → full rebuild
    return processQuadrantA(client, svc, item, options);
  } else {
    // 象限 B：有 content、无 chunks → 直接 embed(content)
    return processQuadrantB(client, svc, item, options);
  }
}

/**
 * chunks-only 模式：只 embed chunks，不更新 items.embedding
 */
async function processChunksOnly(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  item: ItemWithChunks,
  _options: RebuildOptions,
): Promise<ProcessResult> {
  if (item.chunks.length === 0) {
    return { status: 'skipped', skipped: true };
  }

  // 并发 embed 所有 chunks
  const chunkEmbedResults = await Promise.all(
    item.chunks.map(chunk => embedTolerant(svc, chunk.content)),
  );

  // 更新 chunks.embedding
  const chunkUpdates: Promise<unknown>[] = [];
  for (let i = 0; i < item.chunks.length; i++) {
    const chunk = item.chunks[i];
    const emb = chunkEmbedResults[i];
    const serialized = serializeEmbedding(emb);
    chunkUpdates.push(
      client
        .from('knowledge_chunks')
        .update({ embedding: serialized })
        .eq('id', chunk.id)
        .then(({ error }: { error: unknown }) => {
          if (error) throw error;
        }),
    );
  }
  await Promise.all(chunkUpdates);
  return { status: 'success' };
}

// ============================================================
// Text Content Builders (copied from service layer)
// ============================================================

function buildProductTextContent(product: {
  name: string;
  sku: string;
  brand?: string | null;
  category?: string | null;
  specifications?: Array<{ key: string; value: string }> | null;
  features?: string[] | null;
  description?: string | null;
  usage_instructions?: string | null;
}): string {
  const parts: string[] = [
    `【商品名称】${product.name}`,
    `【SKU】${product.sku}`,
  ];
  if (product.brand) parts.push(`【品牌】${product.brand}`);
  if (product.category) parts.push(`【分类】${product.category}`);
  if (product.specifications?.length) {
    parts.push('【规格参数】');
    for (const spec of product.specifications) {
      parts.push(`  ${spec.key}：${spec.value}`);
    }
  }
  if (product.features?.length) {
    parts.push('【商品卖点】');
    for (const feat of product.features) {
      parts.push(`  · ${feat}`);
    }
  }
  if (product.description) parts.push(`【商品描述】${product.description}`);
  if (product.usage_instructions) parts.push(`【使用说明】${product.usage_instructions}`);
  return parts.join('\n');
}

function buildSizeChartTextContent(chart: {
  name: string;
  category?: string | null;
  chart_type?: string | null;
  size_columns?: Array<{ key: string; label: string }> | null;
  size_rows?: Array<Record<string, string>> | null;
  recommend_params?: { dimensions?: Array<{ key: string; label: string; unit?: string }> } | null;
  description?: string | null;
}): string {
  const parts: string[] = [
    `【尺码表名称】${chart.name}`,
  ];
  if (chart.category) parts.push(`【适用分类】${chart.category}`);
  if (chart.chart_type) parts.push(`【尺码表类型】${chart.chart_type}`);
  if (chart.size_columns?.length) {
    parts.push('【尺码列】' + chart.size_columns.map(c => c.label).join(' / '));
  }
  if (chart.size_rows?.length) {
    parts.push('【尺码数据】');
    for (const row of chart.size_rows.slice(0, 20)) {
      parts.push('  ' + Object.values(row).join(' | '));
    }
  }
  if (chart.description) parts.push(`【补充说明】${chart.description}`);
  return parts.join('\n');
}

// ============================================================
// Product Details Rebuild
// ============================================================

async function rebuildProductDetails(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  options: RebuildOptions,
  startingOffset = 0,
): Promise<ProgressTracker> {
  const tracker: ProgressTracker = { processed: 0, succeeded: 0, skipped: 0, failed: 0, errors: [] };

  if (options.scope !== 'product' && options.scope !== 'all') {
    console.log('\n[SKIP] product scope not selected.\n');
    return tracker;
  }

  console.log('\n=== Rebuilding Product Details ===\n');

  // 统计
  let countQuery = client
    .from('product_details')
    .select('id', { count: 'exact', head: true });
  if (!options.includeInactive) {
    countQuery = countQuery.eq('status', 'on_sale');
  }
  const { count: total } = await countQuery;
  const totalCount = total ?? 0;
  console.log(`Total product_details to process: ${totalCount}`);

  if (options.dryRun || totalCount === 0) {
    if (options.dryRun) console.log('[DRY-RUN] Skipping actual rebuild.');
    return tracker;
  }

  let offset = startingOffset;
  const { pageSize, concurrency } = options;
  const productRepo = new ProductDetailRepository(client);

  while (true) {
    let query = client
      .from('product_details')
      .select('id, name, sku, brand, category, specifications, features, description, usage_instructions')
      .range(offset, offset + pageSize - 1);
    if (!options.includeInactive) {
      query = query.eq('status', 'on_sale');
    }
    const { data: products } = await query;
    if (!products || products.length === 0) break;

    // 分批并发
    const batches: Array<Array<Record<string, unknown>>> = [];
    for (let i = 0; i < products.length; i += concurrency) {
      batches.push((products as Array<Record<string, unknown>>).slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async product => {
          const text = buildProductTextContent(product as Parameters<typeof buildProductTextContent>[0]);
          if (!text || text.trim().length === 0) return 'skipped';
          const emb = await embedTolerant(svc, text);
          if (!emb) return 'skipped';
          try {
            await productRepo.updateEmbedding(product.id as string, emb);
          } catch (err) {
            throw new Error(`updateEmbedding failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          return 'success';
        }),
      );

      for (let ri = 0; ri < results.length; ri++) {
        const result = results[ri];
        tracker.processed++;
        if (result.status === 'fulfilled') {
          if (result.value === 'success') tracker.succeeded++;
          else tracker.skipped++;
        } else {
          tracker.failed++;
          tracker.errors.push({
            id: (batch[ri] as { id: string }).id,
            reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
        if (tracker.processed % 10 === 0) {
          reportProgress(tracker.processed, totalCount, 'products');
        }
      }
    }

    offset += pageSize;
    if (offset >= totalCount) break;
  }

  reportProgress(totalCount, totalCount, 'products');
  return tracker;
}

// ============================================================
// Size Charts Rebuild
// ============================================================

async function rebuildSizeCharts(
  client: ReturnType<typeof getSupabaseClient>,
  svc: Awaited<ReturnType<typeof getEmbeddingService>>,
  options: RebuildOptions,
  startingOffset = 0,
): Promise<ProgressTracker> {
  const tracker: ProgressTracker = { processed: 0, succeeded: 0, skipped: 0, failed: 0, errors: [] };

  if (options.scope !== 'size-chart' && options.scope !== 'all') {
    console.log('\n[SKIP] size-chart scope not selected.\n');
    return tracker;
  }

  console.log('\n=== Rebuilding Size Charts ===\n');

  let countQuery = client
    .from('size_charts')
    .select('id', { count: 'exact', head: true });
  if (!options.includeInactive) {
    countQuery = countQuery.eq('status', 'active');
  }
  const { count: total } = await countQuery;
  const totalCount = total ?? 0;
  console.log(`Total size_charts to process: ${totalCount}`);

  if (options.dryRun || totalCount === 0) {
    if (options.dryRun) console.log('[DRY-RUN] Skipping actual rebuild.');
    return tracker;
  }

  let offset = startingOffset;
  const { pageSize, concurrency } = options;
  const sizeChartRepo = new SizeChartRepository(client);

  while (true) {
    let query = client
      .from('size_charts')
      .select('id, name, category, chart_type, size_columns, size_rows, recommend_params, description')
      .range(offset, offset + pageSize - 1);
    if (!options.includeInactive) {
      query = query.eq('status', 'active');
    }
    const { data: charts } = await query;
    if (!charts || charts.length === 0) break;

    const batches: Array<Array<Record<string, unknown>>> = [];
    for (let i = 0; i < charts.length; i += concurrency) {
      batches.push((charts as Array<Record<string, unknown>>).slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async chart => {
          const text = buildSizeChartTextContent(chart as Parameters<typeof buildSizeChartTextContent>[0]);
          if (!text || text.trim().length === 0) return 'skipped';
          const emb = await embedTolerant(svc, text);
          if (!emb) return 'skipped';
          try {
            await sizeChartRepo.updateEmbedding(chart.id as string, emb);
          } catch (err) {
            throw new Error(`updateEmbedding failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          return 'success';
        }),
      );

      for (let ri = 0; ri < results.length; ri++) {
        const result = results[ri];
        tracker.processed++;
        if (result.status === 'fulfilled') {
          if (result.value === 'success') tracker.succeeded++;
          else tracker.skipped++;
        } else {
          tracker.failed++;
          tracker.errors.push({
            id: (batch[ri] as { id: string }).id,
            reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
        if (tracker.processed % 10 === 0) {
          reportProgress(tracker.processed, totalCount, 'size-charts');
        }
      }
    }

    offset += pageSize;
    if (offset >= totalCount) break;
  }

  reportProgress(totalCount, totalCount, 'size-charts');
  return tracker;
}

interface ProgressState {
  knowledge: { offset: number };
  product: { offset: number };
  sizeChart: { offset: number };
}

function saveProgress(state: ProgressState): void {
  try {
    const fs = require('node:fs');
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

function loadProgress(): ProgressState | null {
  try {
    const fs = require('node:fs');
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return null;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(`
Knowledge Base Embedding Rebuild Script

Usage:
  pnpm tsx scripts/rebuild-knowledge-embeddings.ts [options]

Options:
  --mode=full|repair|chunks-only  Reconstruction mode (default: full)
    full        — Re-embed existing chunks (via Mean Pooling), or fallback to embedding raw content; does NOT re-chunk text
    repair      — Four-quadrant repair: only fix items with missing embeddings
    chunks-only — Re-embed chunks.embedding only (no Mean Pooling, no item.embedding update)

  --scope=knowledge|product|size-chart|all  Entity scope (default: knowledge)
    knowledge  — Rebuild knowledge_items + knowledge_chunks
    product    — Rebuild product_details
    size-chart — Rebuild size_charts
    all        — Rebuild all three entities

  --dry-run                     Print what would be processed, no DB writes
  --include-archived            Include archived knowledge items
  --include-inactive            Include off-sale products and disabled size charts
  --concurrency=N               Concurrent embed calls per batch (default: 5)
  --page-size=N                 DB records per page (default: 50)
  --model=NAME                  Override Ollama embedding model
  --resume                      Resume from last checkpoint (.rebuild-progress.json)

Examples:
  # Full rebuild of all knowledge items
  pnpm tsx scripts/rebuild-knowledge-embeddings.ts --mode=full --scope=knowledge

  # Repair missing embeddings only (four-quadrant logic)
  pnpm tsx scripts/rebuild-knowledge-embeddings.ts --mode=repair --scope=knowledge

  # Rebuild chunks only (debugging)
  pnpm tsx scripts/rebuild-knowledge-embeddings.ts --mode=chunks-only --scope=knowledge

  # Dry run to see how many records would be processed
  pnpm tsx scripts/rebuild-knowledge-embeddings.ts --dry-run --mode=full --scope=all

  # Resume interrupted rebuild
  pnpm tsx scripts/rebuild-knowledge-embeddings.ts --resume --mode=full --scope=all
`);
    process.exit(0);
  }

  let options: RebuildOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error('[ERROR]', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Knowledge Base Embedding Rebuild');
  console.log('========================================');
  console.log(`  Mode:        ${options.mode}`);
  console.log(`  Scope:       ${options.scope}`);
  console.log(`  Dry run:     ${options.dryRun}`);
  console.log(`  Concurrency: ${options.concurrency}`);
  console.log(`  Page size:   ${options.pageSize}`);
  console.log('========================================\n');

  const client = getSupabaseClient();
  const svc = getEmbeddingService();

  // Load checkpoint if resuming
  const savedProgress = options.resume ? loadProgress() : null;
  if (savedProgress) {
    console.log(`\n[RESUME] Loaded checkpoint from ${PROGRESS_FILE}`);
    if (savedProgress.knowledge) console.log(`  knowledge offset:  ${savedProgress.knowledge.offset}`);
    if (savedProgress.product) console.log(`  product offset:    ${savedProgress.product.offset}`);
    if (savedProgress.sizeChart) console.log(`  sizeChart offset:  ${savedProgress.sizeChart.offset}`);
    console.log('');
  }

  // Pre-flight checks
  const totalEstimate = await runPreFlightChecks(svc, options);

  if (options.dryRun) {
    console.log(`\n[DRY-RUN] Would process ~${totalEstimate} records total.`);
    console.log('No database writes were performed.\n');
    process.exit(0);
  }

  // Confirmation prompt
  if (process.stdin.isTTY) {
    process.stdout.write(`\n⚠️  This will rebuild embeddings for ~${totalEstimate} records.\n   Press ENTER to continue or Ctrl+C to abort: `);
    // In non-interactive context, skip confirmation
  }

  // Run rebuilds with checkpoint saving
  const allTrackers: ProgressTracker[] = [];
  const progressState: ProgressState = { knowledge: { offset: 0 }, product: { offset: 0 }, sizeChart: { offset: 0 } };

  let kiOffset = savedProgress?.knowledge?.offset ?? 0;
  const kiTracker = await rebuildKnowledgeItems(client, svc, options, kiOffset);
  kiOffset += kiTracker.processed;
  progressState.knowledge.offset = kiOffset;
  if (!options.dryRun) saveProgress(progressState);
  allTrackers.push(kiTracker);

  let pdOffset = savedProgress?.product?.offset ?? 0;
  const pdTracker = await rebuildProductDetails(client, svc, options, pdOffset);
  pdOffset += pdTracker.processed;
  progressState.product.offset = pdOffset;
  if (!options.dryRun) saveProgress(progressState);
  allTrackers.push(pdTracker);

  let scOffset = savedProgress?.sizeChart?.offset ?? 0;
  const scTracker = await rebuildSizeCharts(client, svc, options, scOffset);
  scOffset += scTracker.processed;
  progressState.sizeChart.offset = scOffset;
  if (!options.dryRun) saveProgress(progressState);
  allTrackers.push(scTracker);

  // Final report
  const totalProcessed = allTrackers.reduce((sum, t) => sum + t.processed, 0);
  const totalSucceeded = allTrackers.reduce((sum, t) => sum + t.succeeded, 0);
  const totalSkipped = allTrackers.reduce((sum, t) => sum + t.skipped, 0);
  const totalFailed = allTrackers.reduce((sum, t) => sum + t.failed, 0);
  const allErrors = allTrackers.flatMap(t => t.errors);

  console.log('\n========================================');
  console.log('  Final Report');
  console.log('========================================');
  console.log(`  Processed:   ${totalProcessed}`);
  console.log(`  Succeeded:   ${totalSucceeded}`);
  console.log(`  Skipped:     ${totalSkipped}`);
  console.log(`  Failed:      ${totalFailed}`);

  if (allErrors.length > 0) {
    console.log('\n  Failed records (first 20):');
    for (const err of allErrors.slice(0, 20)) {
      console.log(`    ${err.id}: ${err.reason.slice(0, 100)}`);
    }
    if (allErrors.length > 20) {
      console.log(`    ... and ${allErrors.length - 20} more errors`);
    }
  }

  console.log('\nDone.\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
