import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { ChunkRecord } from '@/server/services/text-chunker';

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
   */
  async getActiveChunks(itemId: string, version?: number): Promise<KnowledgeChunk[]> {
    let query = this.client
      .from('knowledge_chunks')
      .select('*')
      .eq('knowledge_item_id', itemId)
      .is('version_removed', null)
      .order('chunk_index', { ascending: true });
    if (typeof version === 'number') {
      // 历史版本：再过滤 version_added <= version
      query = query.lte('version_added', version);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as KnowledgeChunk[];
  }

  /**
   * 取出某条目在指定版本生效的 chunks，但允许一些 chunk 的 version_removed <= version
   * 实现：先取所有 chunks，再内存过滤
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
