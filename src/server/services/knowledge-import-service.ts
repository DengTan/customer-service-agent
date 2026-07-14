import { getEmbeddingService } from './embedding-service';
import { KnowledgeImportJobRepository, type ChunkPreview } from '@/server/repositories/knowledge-import-job-repository';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createHash, randomUUID } from 'node:crypto';
import {
  extractRawTextPreview,
  extractChunkPreview,
  extractTextFromBuffer,
  getFileType,
  computeContentHash,
  normalizeToMarkdown,
} from './text-extractor';
import { smartChunkText } from './smart-chunking-service';
import { logger } from '@/lib/logger';
import * as nodeFs from 'node:fs';
import nodePath from 'node:path';

const MimeTypeMap: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const AllowedExtensions = [
  '.xlsx', '.xls', '.csv',
  '.pdf', '.docx', '.doc',
  '.md', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
];

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'smartassist';
const STORAGE_URL_EXPIRY_SECONDS = 365 * 24 * 60 * 60; // 365 days for knowledge images

export class KnowledgeImportService {
  private jobRepository: KnowledgeImportJobRepository;
  private supabase = getSupabaseClient();

  constructor() {
    this.jobRepository = new KnowledgeImportJobRepository();
  }

  /**
   * 创建导入任务并开始异步处理
   */
  async createJob(params: {
    file: File;
    name?: string;
    category?: string;
    parentCategory?: string;
    imageUrl?: string;
    description?: string;
    userId?: string;
  }): Promise<{ jobId: string }> {
    const { file, name, category, parentCategory, imageUrl, description, userId } = params;

    // 验证文件
    const ext = this.getExtension(file.name);
    if (!AllowedExtensions.includes(ext)) {
      throw new Error(`不支持的文件格式，仅支持 ${AllowedExtensions.join('、')} 文件`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制（最大 20MB）`);
    }

    // 创建任务记录
    const job = await this.jobRepository.create({
      file_name: name || file.name,
      file_size: file.size,
      file_type: getFileType(file.name),
      category: category || '未分类',
      parent_category: parentCategory || undefined,
      image_url: imageUrl || undefined,
      description: description || undefined,
      created_by: userId || undefined,
    });

    // 触发异步处理
    this.processJobAsync(job.id, file);

    return { jobId: job.id };
  }

  /**
   * 异步处理导入任务
   */
  private async processJobAsync(jobId: string, file: File): Promise<void> {
    // 使用 setImmediate 让处理在下一个事件循环执行
    setImmediate(async () => {
      try {
        await this.processJob(jobId, file);
      } catch (error) {
        logger.api.error('knowledge-import-job-failed', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.jobRepository.update(jobId, {
          status: 'failed',
          error_message: error instanceof Error ? error.message : '处理失败',
          progress: 0,
          stage: 'failed',
        });
      }
    });
  }

  /**
   * 处理导入任务的完整流程
   */
  private async processJob(jobId: string, file: File): Promise<void> {
    let fileBuffer: Buffer | null = null;
    let storagePath: string | null = null;

    try {
      const ext = this.getExtension(file.name);
      const isImage = IMAGE_EXTENSIONS.has(ext);

      // Stage 1: 上传文件到 Storage (0-20%)
      await this.jobRepository.update(jobId, {
        status: 'processing',
        progress: 5,
        stage: 'uploading',
      });

      fileBuffer = Buffer.from(await file.arrayBuffer());

      // 检查重复
      const contentHash = computeContentHash(fileBuffer);
      const existingItem = await this.checkDuplicate(contentHash);
      if (existingItem) {
        throw new Error(`内容重复：已存在相同内容的条目「${existingItem}」，请勿重复导入`);
      }

      // Upload to Supabase Storage (sanitize filename to avoid invalid key errors)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      storagePath = `knowledge/${jobId}_${safeName}`;
      const { data: uploadData, error: uploadError } = await this.supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: MimeTypeMap[ext] || 'application/octet-stream',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`文件上传失败: ${uploadError.message}`);
      }

      // Supabase Storage upload returns the path as the data
      const uploadedPath = typeof uploadData === 'string' ? uploadData : (uploadData as { path?: string }).path;
      storagePath = uploadedPath || null;

      // === Image simplified pipeline ===
      if (isImage) {
        if (!storagePath) {
          throw new Error('storagePath is null, file upload failed');
        }
        // Generate long-lived signed URL for the image
        const { data: signedUrlData, error: signedUrlError } = await this.supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(storagePath, STORAGE_URL_EXPIRY_SECONDS);

        if (signedUrlError) {
          logger.api.warn('knowledge-storage-signed-url-failed', {
            jobId,
            path: storagePath,
            error: signedUrlError.message,
          });
          // Fallback to public URL if signed URL fails
        }

        const presignedUrl = signedUrlData?.signedUrl || null;

        await this.jobRepository.update(jobId, {
          progress: 50,
          stage: 'vectorizing',
        });

        // Optionally vectorize description text
        const job = await this.jobRepository.findById(jobId);
        const description = ((job?.description) || '').trim();
        let embedding: number[] | null = null;
        if (description) {
          try {
            const embeddingService = getEmbeddingService();
            embedding = await embeddingService.embed(description);
          } catch (vectorError) {
            // Item 1: 向量化失败时清理已上传的 Storage 文件，防止存储泄漏
            if (storagePath) await this.safeDeleteStorage(storagePath);
            throw vectorError;
          }
        }

        await this.jobRepository.update(jobId, {
          progress: 85,
          stage: 'syncing',
        });

        // Save knowledge item as image type
        const finalJob = await this.jobRepository.findById(jobId);
        const { data: newItem, error: dbError } = await this.supabase
          .from('knowledge_items')
          .insert({
            name: finalJob?.file_name || '导入图片',
            type: 'image',
            content: description || file.name,
            content_hash: contentHash,
            chunk_count: 1,
          image_url: presignedUrl,
          embedding: embedding ? JSON.stringify(embedding) : null,
          category: finalJob?.category || '未分类',
          parent_category: finalJob?.parent_category,
          status: 'active',
        })
          .select('id')
          .single();

        if (dbError) {
          // Item 1: DB 写入失败时清理已上传的 Storage 文件，防止存储泄漏
          if (storagePath) await this.safeDeleteStorage(storagePath);
          throw new Error(`保存知识条目失败: ${dbError.message}`);
        }

        await this.jobRepository.update(jobId, {
          status: 'completed',
          progress: 100,
          stage: 'completed',
          knowledge_item_id: newItem.id,
        });

        logger.api.info('knowledge-import-image-completed', {
          jobId,
          knowledgeItemId: newItem.id,
          hasDescription: description.trim().length > 0,
        });

        return;
      }

      // === Non-image: full pipeline ===
      await this.jobRepository.update(jobId, {
        progress: 20,
        stage: 'parsing',
      });

      // Stage 2: 解析文档提取文本并规范化为 Markdown 格式 (20-40%)
      const fileType = getFileType(file.name);
      let extractedText: string;

      try {
        extractedText = await extractTextFromBuffer(fileBuffer, fileType);
        // Normalize to clean Markdown format
        extractedText = normalizeToMarkdown(extractedText);
      } catch {
        logger.api.warn('text-extraction-failed', { jobId, fileType });
        extractedText = '[文档解析失败，内容可能无法被检索]';
      }

      // 保存原始文本预览
      await this.jobRepository.update(jobId, {
        progress: 40,
        stage: 'chunking',
        description: extractRawTextPreview(extractedText),
      });

      // Stage 3: 智能分段（LLM 自动分段，回退到规则分段）
      const chunks = await smartChunkText(extractedText, {
        chunkSize: 500,
        overlap: 50,
        enableLLMChunking: true,
      });

      // 分段失败时抛出错误
      if (chunks.length === 0) {
        throw new Error('文档分段失败，无法继续导入');
      }

      const chunkPreview: ChunkPreview[] = extractChunkPreview(chunks).map(c => ({
        index: c.index,
        content: c.content,
        content_hash: c.content_hash,
      }));

      await this.jobRepository.update(jobId, {
        progress: 55,
        stage: 'chunking',
        chunks_preview: chunkPreview,
        total_chunks: chunks.length,
      });

      // Stage 4: 本地向量化 (60-90%)
      await this.jobRepository.update(jobId, {
        progress: 65,
        stage: 'vectorizing',
      });

      const embeddingService = getEmbeddingService();
      const chunkTexts = chunks.map(c => c.content);

      let embeddings: number[][] = [];
      try {
        embeddings = await embeddingService.embedBatch(chunkTexts);
      } catch (embedError) {
        // #region DEBUG: Log embedding error
        fetch('http://127.0.0.1:7629/ingest/5e38ffe2-e53d-40da-b607-4844afcb34e1', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'X-Debug-Session-Id': '04a2b6'},
          body: JSON.stringify({
            sessionId: '04a2b6',
            location: 'knowledge-import-service.ts:processJob:embedBatch:error',
            message: 'embedBatch threw error',
            data: { jobId, error: embedError instanceof Error ? embedError.message : String(embedError) },
            timestamp: Date.now(),
            hypothesisId: 'embed-debug'
          })
        }).catch(() => {});
        // #endregion
        throw embedError;
      }
      
      // #region DEBUG: Log embedding results
      console.log('[DEBUG] Embeddings result:', {
        type: typeof embeddings,
        isArray: Array.isArray(embeddings),
        length: embeddings?.length,
        firstEmbedType: typeof embeddings[0],
        isFirstEmbedArray: Array.isArray(embeddings[0]),
        firstEmbedLength: embeddings[0]?.length,
        allLengths: embeddings?.map((e: unknown) => Array.isArray(e) ? e.length : 'not-array'),
      });

      // DEBUG: Write to file
      try {
        const debugPath = nodePath.join(process.cwd(), 'logs', 'embed-debug.log');
        nodeFs.appendFileSync(debugPath, `[${new Date().toISOString()}] jobId=${jobId} embeddings.length=${embeddings?.length} firstLength=${embeddings[0]?.length || 0} allLengths=${JSON.stringify(embeddings?.map((e: unknown) => Array.isArray(e) ? (e as number[]).length : 'not-array'))}\n`);
      } catch (e) {
        console.log('[DEBUG] Failed to write debug log:', (e as Error)?.message);
      }
      // #endregion

      // Stage 5: 保存知识条目 (85-100%)
      const job = await this.jobRepository.findById(jobId);
      if (!job) {
        throw new Error('任务记录不存在');
      }

      const { data: newItem, error: dbError } = await this.supabase
        .from('knowledge_items')
        .insert({
          name: job.file_name || '导入文件',
          type: 'file',
          content: extractedText,
          content_hash: contentHash,
          category: job.category || '未分类',
          parent_category: job.parent_category,
          status: 'active',
          chunk_count: chunks.length,
          image_url: job.image_url,
          embedding: embeddings[0] && embeddings[0].length > 0 ? JSON.stringify(embeddings[0]) : null,
        })
        .select('id')
        .single();

      // #region DEBUG: Log embedding insert value
      // #endregion

      if (dbError) {
        throw new Error(`保存知识条目失败: ${dbError.message}`);
      }

      // Insert chunk embeddings
      const chunkInserts = chunks.map((c, i) => ({
        id: randomUUID(),
        knowledge_item_id: newItem.id,
        chunk_index: c.index,
        content: c.content,
        content_hash: c.content_hash,
        embedding: embeddings[i] && embeddings[i].length > 0 ? JSON.stringify(embeddings[i]) : null,
      }));
      
      // #region DEBUG: Log chunk insertion
      fetch('http://127.0.0.1:7629/ingest/5e38ffe2-e53d-40da-b607-4844afcb34e1', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Debug-Session-Id': '04a2b6'},
        body: JSON.stringify({
          sessionId: '04a2b6',
          location: 'knowledge-import-service.ts:processJob',
          message: 'Inserting chunks',
          data: { jobId, chunkCount: chunks.length, firstChunkId: chunkInserts[0]?.id },
          timestamp: Date.now(),
          hypothesisId: 'chunk-insert'
        })
      }).catch(() => {});
      // #endregion
      
      const { error: chunkError } = await this.supabase.from('knowledge_chunks').insert(chunkInserts);
      
      // #region DEBUG: Log chunk insertion result
      fetch('http://127.0.0.1:7629/ingest/5e38ffe2-e53d-40da-b607-4844afcb34e1', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Debug-Session-Id': '04a2b6'},
        body: JSON.stringify({
          sessionId: '04a2b6',
          location: 'knowledge-import-service.ts:processJob:chunkInsertResult',
          message: 'Chunk insertion result',
          data: { jobId, chunkError: chunkError?.message || 'success', chunkErrorDetails: chunkError?.details || null },
          timestamp: Date.now(),
          hypothesisId: 'chunk-insert'
        })
      }).catch(() => {});
      // #endregion
      
      if (chunkError) {
        logger.agent.error('Failed to insert knowledge_chunks', { jobId, error: chunkError });
        throw new Error(`插入chunks失败: ${chunkError.message}`);
      }

      // Update knowledge_items with first chunk embedding
      await this.supabase.from('knowledge_items').update({ embedding: embeddings[0] && embeddings[0].length > 0 ? JSON.stringify(embeddings[0]) : null }).eq('id', newItem.id);

      // 更新任务状态为完成
      await this.jobRepository.update(jobId, {
        status: 'completed',
        progress: 100,
        stage: 'completed',
        knowledge_item_id: newItem.id,
      });

      logger.api.info('knowledge-import-job-completed', {
        jobId,
        knowledgeItemId: newItem.id,
        totalChunks: chunks.length,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取任务状态
   * @param userId - 当前登录用户 ID，可选（未登录用户只能查看公开任务）
   */
  async getJobStatus(jobId: string, userId?: string | null): Promise<{
    id: string;
    status: string;
    progress: number;
    currentStage: string;
    chunkPreview: ChunkPreview[] | null;
    totalChunks: number;
    rawTextPreview: string | null;
    errorMessage: string | null;
    knowledgeItemId: string | null;
    createdAt: string;
    isOwner: boolean;
  } | null> {
    const job = await this.jobRepository.findById(jobId);
    if (!job) return null;

    // 权限校验：非创建者且未登录，无法查看任务详情
    if (job.created_by && userId && job.created_by !== userId) {
      return null; // 返回 null 表示无权限
    }

    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      currentStage: job.stage || '',
      chunkPreview: job.chunks_preview,
      totalChunks: job.total_chunks,
      rawTextPreview: job.description,
      errorMessage: job.error_message,
      knowledgeItemId: job.knowledge_item_id,
      createdAt: job.created_at,
      isOwner: !job.created_by || job.created_by === userId,
    };
  }

  /**
   * 获取用户进行中的任务
   */
  async getActiveJobs(userId?: string): Promise<Array<{
    id: string;
    status: string;
    progress: number;
    currentStage: string;
    fileName: string;
    createdAt: string;
  }>> {
    const jobs = await this.jobRepository.findActiveByUser(userId || null);
    return jobs.map(job => ({
      id: job.id,
      status: job.status,
      progress: job.progress,
      currentStage: job.stage || '',
      fileName: job.file_name || '导入文件',
      createdAt: job.created_at,
    }));
  }

  /**
   * 删除任务
   */
  async deleteJob(jobId: string): Promise<void> {
    await this.jobRepository.delete(jobId);
  }

  /**
   * 检查内容重复
   */
  private async checkDuplicate(contentHash: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('knowledge_items')
      .select('name')
      .eq('content_hash', contentHash)
      .eq('status', 'active')
      .maybeSingle();

    return data?.name || null;
  }

  /**
   * 获取文件扩展名
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
  }

  /**
   * Item 1: 安全删除 Storage 文件（best-effort，不影响主错误）
   */
  private async safeDeleteStorage(path: string): Promise<void> {
    try {
      const { error } = await this.supabase.storage
        .from(STORAGE_BUCKET)
        .remove([path]);

      if (error) {
        logger.api.warn('knowledge-storage-delete-failed', {
          path,
          error: error.message,
        });
      }
    } catch {
      // best-effort，删除失败不影响主错误
    }
  }
}

export const knowledgeImportService = new KnowledgeImportService();
