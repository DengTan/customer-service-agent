import { KnowledgeImportJobRepository, type ChunkPreview } from '@/server/repositories/knowledge-import-job-repository';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createHash } from 'node:crypto';
import {
  chunkText,
  extractRawTextPreview,
  extractChunkPreview,
  extractTextFromBuffer,
  getFileType,
  computeContentHash,
} from './text-extractor';
import { S3Storage } from 'coze-coding-dev-sdk';
import { KnowledgeClient, Config, KnowledgeDocument, DataSourceType } from 'coze-coding-dev-sdk';
import { logger } from '@/lib/logger';

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
          current_stage: 'failed',
        });
      }
    });
  }

  /**
   * 处理导入任务的完整流程
   */
  private async processJob(jobId: string, file: File): Promise<void> {
    let fileBuffer: Buffer | null = null;
    let storageKey: string | null = null;

    try {
      const ext = this.getExtension(file.name);
      const isImage = IMAGE_EXTENSIONS.has(ext);

      // Stage 1: 上传文件到 S3 (0-20%)
      await this.jobRepository.update(jobId, {
        status: 'processing',
        progress: 5,
        current_stage: 'uploading',
      });

      fileBuffer = Buffer.from(await file.arrayBuffer());

      // 检查重复
      const contentHash = computeContentHash(fileBuffer);
      const existingItem = await this.checkDuplicate(contentHash);
      if (existingItem) {
        throw new Error(`内容重复：已存在相同内容的条目「${existingItem}」，请勿重复导入`);
      }

      const storage = this.initS3Storage();
      storageKey = await storage.uploadFile({
        fileContent: fileBuffer,
        fileName: `knowledge/${file.name}`,
        contentType: MimeTypeMap[ext] || 'application/octet-stream',
      });

      // === Image simplified pipeline ===
      if (isImage) {
        // Generate long-lived presigned URL for the image
        const presignedUrl = await storage.generatePresignedUrl({
          key: storageKey,
          expireTime: 86400 * 365, // 365 days for knowledge images
        });

        await this.jobRepository.update(jobId, {
          progress: 50,
          current_stage: 'vectorizing',
        });

        // Optionally vectorize description text
        const job = await this.jobRepository.findById(jobId);
        // N1: 在赋值时统一 trim，后续使用不再重复调用
        const description = ((job?.raw_text_preview) || '').trim();
        let docIds: string[] = [];
        if (description) {
          try {
            const config = new Config();
            const client = new KnowledgeClient(config);
            const documents: KnowledgeDocument[] = [
              { source: DataSourceType.TEXT, raw_data: description },
            ];
            const result = await client.addDocuments(documents, 'coze_doc_knowledge', {
              separator: '\n\n',
              max_tokens: 2000,
            });
            if (result.code !== 0) {
              throw new Error(`图片描述向量化失败: ${result.msg}`);
            }
            docIds = result.doc_ids || [];
          } catch (vectorError) {
            // Item 1: 向量化失败时清理已上传的 S3 文件，防止存储泄漏
            await this.safeDeleteS3(storageKey);
            throw vectorError;
          }
        }

        await this.jobRepository.update(jobId, {
          progress: 85,
          current_stage: 'syncing',
          doc_ids: docIds,
        });

        // Save knowledge item as image type
        const finalJob = await this.jobRepository.findById(jobId);
        const { data: newItem, error: dbError } = await this.supabase
          .from('knowledge_items')
          .insert({
            name: finalJob?.file_name || '导入图片',
            type: 'image',
            // N1: description 已在上面统一 trim，这里直接使用
            content: description.slice(0, 500) || file.name,
            content_hash: contentHash,
            doc_ids: docIds,
            category: finalJob?.category || '未分类',
            parent_category: finalJob?.parent_category,
            status: 'active',
            chunk_count: docIds.length,
            image_url: presignedUrl,
          })
          .select('id')
          .single();

        if (dbError) {
          // Item 1: DB 写入失败时清理已上传的 S3 文件，防止存储泄漏
          await this.safeDeleteS3(storageKey);
          throw new Error(`保存知识条目失败: ${dbError.message}`);
        }

        await this.jobRepository.update(jobId, {
          status: 'completed',
          progress: 100,
          current_stage: 'completed',
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
        current_stage: 'parsing',
      });

      // Stage 2: 解析文档提取文本 (20-40%)
      const fileType = getFileType(file.name);
      let extractedText: string;

      try {
        extractedText = await extractTextFromBuffer(fileBuffer, fileType);
      } catch {
        logger.api.warn('text-extraction-failed', { jobId, fileType });
        extractedText = '[文档解析失败，内容可能无法被检索]';
      }

      // 保存原始文本预览
      await this.jobRepository.update(jobId, {
        progress: 40,
        current_stage: 'chunking',
        raw_text_preview: extractRawTextPreview(extractedText),
      });

      // Stage 3: 本地切分文本 (40-60%)
      const chunks = chunkText(extractedText, 500); // 与 Coze 一致的 chunk size
      const chunkPreview: ChunkPreview[] = extractChunkPreview(chunks).map(c => ({
        index: c.index,
        content: c.content,
        content_hash: c.content_hash,
      }));

      await this.jobRepository.update(jobId, {
        progress: 55,
        current_stage: 'chunking',
        chunk_preview: chunkPreview,
        total_chunks: chunks.length,
      });

      // Stage 4: 发送到 Coze 向量化 (60-90%)
      await this.jobRepository.update(jobId, {
        progress: 65,
        current_stage: 'vectorizing',
      });

      const config = new Config();
      const client = new KnowledgeClient(config);

      const documents: KnowledgeDocument[] = [
        { source: DataSourceType.URI, uri: storageKey },
      ];

      const result = await client.addDocuments(documents, 'coze_doc_knowledge', {
        separator: '\n\n',
        max_tokens: 2000,
      });

      if (result.code !== 0) {
        throw new Error(`Coze向量化失败: ${result.msg}`);
      }

      await this.jobRepository.update(jobId, {
        progress: 85,
        current_stage: 'syncing',
        doc_ids: result.doc_ids || [],
      });

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
          content: extractedText.slice(0, 500),
          content_hash: contentHash,
          doc_ids: result.doc_ids || [],
          category: job.category || '未分类',
          parent_category: job.parent_category,
          status: 'active',
          chunk_count: chunks.length,
          image_url: job.image_url,
        })
        .select('id')
        .single();

      if (dbError) {
        throw new Error(`保存知识条目失败: ${dbError.message}`);
      }

      // 更新任务状态为完成
      await this.jobRepository.update(jobId, {
        status: 'completed',
        progress: 100,
        current_stage: 'completed',
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
      currentStage: job.current_stage || '',
      chunkPreview: job.chunk_preview,
      totalChunks: job.total_chunks,
      rawTextPreview: job.raw_text_preview,
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
      currentStage: job.current_stage || '',
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
   * 初始化 S3 存储
   */
  private initS3Storage(): S3Storage {
    if (!process.env.COZE_BUCKET_ENDPOINT_URL || !process.env.COZE_BUCKET_NAME) {
      throw new Error('对象存储服务未配置，请检查环境变量 COZE_BUCKET_ENDPOINT_URL 和 COZE_BUCKET_NAME');
    }
    return new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      bucketName: process.env.COZE_BUCKET_NAME,
      region: process.env.COZE_BUCKET_REGION || 'cn-beijing',
    });
  }

  /**
   * Item 1: 安全删除 S3 文件（best-effort，不影响主错误）
   */
  private async safeDeleteS3(storageKey: string): Promise<void> {
    try {
      const storage = this.initS3Storage();
      await storage.deleteFile({ fileKey: storageKey });
    } catch {
      // best-effort，删除失败不影响主错误
    }
  }
}

export const knowledgeImportService = new KnowledgeImportService();
