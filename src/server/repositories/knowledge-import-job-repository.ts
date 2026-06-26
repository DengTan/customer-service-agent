import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface ChunkPreview {
  index: number;
  content: string;
  content_hash: string;
}

export interface KnowledgeImportJob {
  id: string;
  knowledge_item_id: string | null;
  file_name: string;
  file_size: number;
  file_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  current_stage: string | null;
  raw_text_preview: string | null;
  chunk_preview: ChunkPreview[] | null;
  total_chunks: number;
  doc_ids: string[] | null;
  error_message: string | null;
  category: string;
  parent_category: string | null;
  image_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobParams {
  file_name: string;
  file_size: number;
  file_type: string;
  category?: string;
  parent_category?: string;
  image_url?: string;
  description?: string;
  created_by?: string;
}

export class KnowledgeImportJobRepository {
  private supabase = getSupabaseClient();
  private tableName = 'knowledge_import_jobs';

  async create(params: CreateJobParams): Promise<KnowledgeImportJob> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert({
        file_name: params.file_name,
        file_size: params.file_size,
        file_type: params.file_type,
        category: params.category || '未分类',
        parent_category: params.parent_category || null,
        image_url: params.image_url || null,
        raw_text_preview: params.description || null,
        created_by: params.created_by || null,
        status: 'pending',
        progress: 0,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`创建导入任务失败: ${error?.message || 'Unknown error'}`);
    }

    return this.mapToModel(data);
  }

  async findById(id: string): Promise<KnowledgeImportJob | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`查询导入任务失败: ${error.message}`);
    }

    return this.mapToModel(data);
  }

  async update(id: string, updates: Partial<{
    status: string;
    progress: number;
    current_stage: string | null;
    raw_text_preview: string | null;
    chunk_preview: ChunkPreview[] | null;
    total_chunks: number;
    doc_ids: string[] | null;
    error_message: string | null;
    knowledge_item_id: string;
  }>): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new Error(`更新导入任务失败: ${error.message}`);
    }
  }

  async findActiveByUser(userId?: string | null): Promise<KnowledgeImportJob[]> {
    let query = this.supabase
      .from(this.tableName)
      .select('id, status, progress, current_stage, file_name, created_at')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (userId) {
      query = query.eq('created_by', userId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`查询进行中任务失败: ${error.message}`);
    }

    return (data || []).map(item => ({
      id: item.id,
      status: item.status,
      progress: item.progress,
      current_stage: item.current_stage,
      file_name: item.file_name,
      created_at: item.created_at,
    } as unknown as KnowledgeImportJob));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`删除导入任务失败: ${error.message}`);
    }
  }

  private mapToModel(data: Record<string, unknown>): KnowledgeImportJob {
    return {
      id: data.id as string,
      knowledge_item_id: data.knowledge_item_id as string | null,
      file_name: data.file_name as string,
      file_size: data.file_size as number,
      file_type: data.file_type as string,
      status: data.status as 'pending' | 'processing' | 'completed' | 'failed',
      progress: data.progress as number,
      current_stage: data.current_stage as string | null,
      raw_text_preview: data.raw_text_preview as string | null,
      chunk_preview: data.chunk_preview as ChunkPreview[] | null,
      total_chunks: data.total_chunks as number,
      doc_ids: data.doc_ids as string[] | null,
      error_message: data.error_message as string | null,
      category: data.category as string,
      parent_category: data.parent_category as string | null,
      image_url: data.image_url as string | null,
      created_by: data.created_by as string | null,
      created_at: data.created_at as string,
      updated_at: data.updated_at as string,
    };
  }
}
