import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface KnowledgeChunk {
  id: string;
  knowledge_item_id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  version_added: number;
  version_removed: number | null;
  created_at: string;
}

export class KnowledgeChunkRepository {
  private get client() {
    return getSupabaseClient();
  }

  /**
   * 取出某条目在指定版本生效的 chunks（version_added <= V && (version_removed IS NULL OR version_removed > V)）
   *
   * 返回全量数据，供版本 diff / 回滚等场景使用（业务侧需要完整列表计算 LCS）。
   * 仅本表数据量较小时可接受；本工程实践中 chunk_count 通常 < 2000。
   */
  async getActiveChunks(itemId: string, version?: number): Promise<KnowledgeChunk[]> {
    let query = this.client
      .from('knowledge_chunks')
      .select('*')
      .eq('knowledge_item_id', itemId)
      .is('version_removed', null)
      .order('chunk_index', { ascending: true });
    if (typeof version === 'number') {
      query = query.lte('version_added', version);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as KnowledgeChunk[];
  }

  /**
   * 分页取出当前生效的 chunks + 总数
   * 真正走 Supabase .range()，仅取一页，避免一次拉全表
   */
  async getActiveChunksPaged(
    itemId: string,
    opts: { offset: number; limit: number; version?: number },
  ): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
    const { offset, limit, version } = opts;
    let q = this.client
      .from('knowledge_chunks')
      .select('*', { count: 'exact' })
      .eq('knowledge_item_id', itemId)
      .is('version_removed', null)
      .order('chunk_index', { ascending: true });
    if (typeof version === 'number') q = q.lte('version_added', version);
    const { data, error, count } = await q.range(offset, offset + limit - 1);
    if (error) throw error;
    return {
      chunks: (data || []) as KnowledgeChunk[],
      total: typeof count === 'number' ? count : (data?.length ?? 0),
    };
  }

  /**
   * 取出某条目在指定版本生效的 chunks，但允许一些 chunk 的 version_removed <= version
   * 实现：先按 version_added 缩小范围，再内存过滤 version_removed
   */
  async getChunksAtVersion(itemId: string, version: number): Promise<KnowledgeChunk[]> {
    const { data, error } = await this.client
      .from('knowledge_chunks')
      .select('*')
      .eq('knowledge_item_id', itemId)
      .lte('version_added', version)
      .order('chunk_index', { ascending: true });
    if (error) throw error;
    return ((data || []) as KnowledgeChunk[]).filter(
      c => c.version_removed === null || c.version_removed > version,
    );
  }

  /**
   * 分页版本：先按 version_added 缩小范围拉一页，内存过滤 version_removed
   * 返回的单页 chunks 与全量 total（total 反映过滤前数量，前端按需自行处理）
   */
  async getChunksAtVersionPaged(
    itemId: string,
    version: number,
    opts: { offset: number; limit: number },
  ): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
    const { offset, limit } = opts;
    const { data, error, count } = await this.client
      .from('knowledge_chunks')
      .select('*', { count: 'exact' })
      .eq('knowledge_item_id', itemId)
      .lte('version_added', version)
      .order('chunk_index', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const filtered = ((data || []) as KnowledgeChunk[]).filter(
      c => c.version_removed === null || c.version_removed > version,
    );
    return {
      chunks: filtered,
      total: typeof count === 'number' ? count : filtered.length,
    };
  }

  /**
   * 标记当前生效 chunks 为在某版本被移除（不回滚场景）
   */
  async markActiveChunksRemoved(itemId: string, version: number): Promise<void> {
    const { error } = await this.client
      .from('knowledge_chunks')
      .update({ version_removed: version })
      .eq('knowledge_item_id', itemId)
      .is('version_removed', null);
    if (error) throw error;
  }

  /**
   * 写入新 chunks
   */
  async insertChunks(chunks: Array<Omit<KnowledgeChunk, "id" | "created_at" | "version_removed">>): Promise<void> {
    if (chunks.length === 0) return;
    const { error } = await this.client
      .from('knowledge_chunks')
      .insert(
        chunks.map(c => ({
          knowledge_item_id: c.knowledge_item_id,
          chunk_index: c.chunk_index,
          content: c.content,
          content_hash: c.content_hash,
          version_added: c.version_added,
          version_removed: null,
        })),
      );
    if (error) throw error;
  }

  /**
   * 物理删除某条目的全部 chunks（极少用，仅在条目整体删除时）
   */
  async hardDeleteAllForItem(itemId: string): Promise<void> {
    const { error } = await this.client
      .from('knowledge_chunks')
      .delete()
      .eq('knowledge_item_id', itemId);
    if (error) throw error;
  }
}

export const knowledgeChunkRepository = new KnowledgeChunkRepository();
