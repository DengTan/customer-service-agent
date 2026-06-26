import { NextRequest } from 'next/server';
import { KnowledgeClient, Config, KnowledgeDocument, DataSourceType } from 'coze-coding-dev-sdk';
import { S3Storage } from 'coze-coding-dev-sdk';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple, checkRateLimit, escapeLikePattern } from '@/lib/api-utils';
import { createHash } from 'crypto';

// Allowed file extensions and their MIME types
// Supports: spreadsheets (.xlsx/.xls/.csv), documents (.pdf/.docx/.doc), text (.md/.txt), images (.jpg/.jpeg/.png/.gif/.webp)
const ALLOWED_EXTENSIONS = [
  '.xlsx', '.xls', '.csv',
  '.pdf', '.docx', '.doc',
  '.md', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
];
const MIME_MAP: Record<string, string> = {
  // Spreadsheets
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  // Documents
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  // Text
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Maximum file size: 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Compute SHA-256 hash of content for dedup.
 * For text: hash the full content.
 * For URL: hash the URL string.
 * For file: hash the file buffer.
 */
function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a knowledge item with the same content hash already exists.
 * Returns the existing item name if found, or null if no duplicate.
 */
async function findDuplicateByHash(contentHash: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('knowledge_items')
    .select('name')
    .eq('content_hash', contentHash)
    .eq('status', 'active')
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

function initS3Storage() {
  // Item 2: 校验 S3 环境变量，缺失时给出明确提示
  if (!process.env.COZE_BUCKET_ENDPOINT_URL || !process.env.COZE_BUCKET_NAME) {
    throw new Error('对象存储服务未配置，请检查环境变量 COZE_BUCKET_ENDPOINT_URL 和 COZE_BUCKET_NAME');
  }
  return new S3Storage({
    endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
    accessKey: '',
    secretKey: '',
    bucketName: process.env.COZE_BUCKET_NAME,
    region: 'cn-beijing',
  });
}

/**
 * Item 1: 安全删除 S3 文件（best-effort，不影响主错误）
 * 解决场景：S3 上传成功 → 后续步骤（向量化/DB写入）失败时，清理已上传文件防止存储泄漏
 */
async function safeDeleteS3(storageKey: string): Promise<void> {
  try {
    const storage = initS3Storage();
    await storage.deleteFile({ fileKey: storageKey });
  } catch {
    // best-effort，删除失败不影响主错误
  }
}

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // Rate limit: 10 imports per minute per IP
  const rateLimitError = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  const contentType = request.headers.get('content-type') || '';

  // Handle file upload (multipart/form-data)
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = (formData.get('name') as string) || '导入文件';
    const category = (formData.get('category') as string) || '未分类';
    const parentCategory = (formData.get('parent_category') as string) || null;
    const imageUrl = (formData.get('image_url') as string) || null;

    if (!file) {
      return apiError('请选择要上传的文件', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return apiError(
        `不支持的文件格式，仅支持 ${ALLOWED_EXTENSIONS.join('、')} 文件`,
        { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiError(
        `文件大小超过限制（最大 20MB）`,
        { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' }
      );
    }

    // 1. Check for duplicate content
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
    const existingName = await findDuplicateByHash(contentHash);
    if (existingName) {
      return apiError(
        `内容重复：已存在相同内容的条目「${existingName}」，请勿重复导入`,
        { status: HttpStatus.CONFLICT, code: 'DUPLICATE_CONTENT' }
      );
    }

    // 2. Upload file to object storage
    const storage = initS3Storage();
    const storageKey = await storage.uploadFile({
      fileContent: fileBuffer,
      fileName: `knowledge/${file.name}`,
      contentType: MIME_MAP[ext] || 'application/octet-stream',
    });

    const isImage = IMAGE_EXTENSIONS.has(ext);
    let docIds: string[] = [];
    let vectorizedContent = '';

    if (isImage) {
      // Image files: generate long-lived presigned URL, store as type='image'
      // Images cannot be vectorized by the knowledge SDK, so we only store the reference
      const presignedUrl = await storage.generatePresignedUrl({
        key: storageKey,
        expireTime: 86400 * 365, // 365 days for knowledge images
      });

      // If a description text was provided, vectorize it
      const description = ((formData.get('description') as string) || '').trim();
      try {
        if (description) {
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
            // Item 1: 向量化失败时清理已上传的 S3 文件，防止存储泄漏
            await safeDeleteS3(storageKey);
            return apiError('图片描述向量化失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: result.msg, code: 'KNOWLEDGE_IMPORT_ERROR' });
          }
          docIds = result.doc_ids || [];
          vectorizedContent = description.slice(0, 500);
        }
      } catch (vectorError) {
        // Item 1: 向量化失败时清理已上传的 S3 文件，防止存储泄漏
        await safeDeleteS3(storageKey);
        throw vectorError;
      }

      // Track in database as image type
      const displayName = name || file.name;
      const supabase = getSupabaseClient();
      const { error: dbError } = await supabase.from('knowledge_items').insert({
        name: displayName,
        type: 'image',
        content: vectorizedContent || file.name,
        content_hash: contentHash,
        doc_ids: docIds,
        category,
        parent_category: parentCategory,
        status: 'active',
        chunk_count: docIds.length,
        image_url: presignedUrl,
      });

      // Item 1: DB 写入失败时清理已上传的 S3 文件，防止存储泄漏
      if (dbError) {
        await safeDeleteS3(storageKey);
        console.error('保存知识库条目失败:', dbError);
        return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
      }

      return apiSuccess({ doc_ids: docIds, image_url: presignedUrl });
    }

    // 3. Non-image: Import to knowledge base using URI
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
      // Item 1: 向量化失败时清理已上传的 S3 文件，防止存储泄漏
      await safeDeleteS3(storageKey);
      return apiError('文件导入知识库失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: result.msg, code: 'KNOWLEDGE_IMPORT_ERROR' });
    }

    // 4. Track in database
    const displayName = name || file.name;
    const supabase = getSupabaseClient();
    const { error: dbError } = await supabase.from('knowledge_items').insert({
      name: displayName,
      type: 'file',
      content: file.name,
      content_hash: contentHash,
      doc_ids: result.doc_ids || [],
      category,
      parent_category: parentCategory,
      status: 'active',
      chunk_count: result.doc_ids?.length || 0,
      image_url: imageUrl,
    });

    // Item 1: DB 写入失败时清理已上传的 S3 文件，防止存储泄漏
    if (dbError) {
      await safeDeleteS3(storageKey);
      console.error('保存知识库条目失败:', dbError);
      return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
    }

    return apiSuccess({ doc_ids: result.doc_ids });
  }

  // Handle text/url import (JSON body)
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;
  const { type, content, url, name, category, parent_category, image_url } = body ?? {};

  // Dedup check for text/url/image content
  const dedupContent = type === 'text' ? (content as string) : type === 'image' ? (image_url as string) : (url as string);
  if (dedupContent) {
    const contentHash = computeContentHash(dedupContent);
    const existingName = await findDuplicateByHash(contentHash);
    if (existingName) {
      return apiError(
        `内容重复：已存在相同内容的条目「${existingName}」，请勿重复导入`,
        { status: HttpStatus.CONFLICT, code: 'DUPLICATE_CONTENT' }
      );
    }
  }

  const config = new Config();
  const client = new KnowledgeClient(config);

  let documents: KnowledgeDocument[];

  if (type === 'text') {
    if (!content) {
      return apiError('文本内容不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }
    documents = [{ source: DataSourceType.TEXT, raw_data: content as string }];
  } else if (type === 'url') {
    if (!url) {
      return apiError('URL不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }
    documents = [{ source: DataSourceType.URL, url: url as string }];
  } else if (type === 'image') {
    // Image type: only stores image_url reference, optionally vectorizes description
    if (!image_url) {
      return apiError('图片类型必须提供 image_url', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    const description = ((content as string) || '').trim();
    if (description) {
      documents = [{ source: DataSourceType.TEXT, raw_data: description }];
    } else {
      // No description to vectorize — just store the image reference
      // content stores the image_url so the item remains searchable
      const imgDisplayName = (name as string) || '导入图片';
      const supabase = getSupabaseClient();
      const { error: dbError } = await supabase.from('knowledge_items').insert({
        name: imgDisplayName,
        type: 'image',
        content: image_url as string,
        content_hash: dedupContent ? computeContentHash(dedupContent as string) : null,
        doc_ids: [],
        category: (category as string) || '未分类',
        parent_category: (parent_category as string) || null,
        status: 'active',
        chunk_count: 0,
        image_url: image_url as string,
      });

      if (dbError) {
        console.error('保存知识库条目失败:', dbError);
        return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
      }

      return apiSuccess({ doc_ids: [] });
    }
  } else {
    return apiError('不支持的导入类型', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await client.addDocuments(documents, 'coze_doc_knowledge', {
    separator: '\n\n',
    max_tokens: 2000,
  });

  if (result.code !== 0) {
    return apiError('导入知识库失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: result.msg, code: 'KNOWLEDGE_IMPORT_ERROR' });
  }

  // Track the imported item in database
  const displayName = (name as string) || (type === 'text' ? '导入文本' : type === 'image' ? '导入图片' : '导入网页');
  const supabase = getSupabaseClient();
  const finalContentHash = dedupContent ? computeContentHash(dedupContent as string) : null;
  const { error: dbError } = await supabase.from('knowledge_items').insert({
    name: displayName,
    type,
    content: type === 'text' ? (content as string).slice(0, 500) : type === 'image' ? ((content as string) || '').slice(0, 500) || (image_url as string) : url,
    content_hash: finalContentHash,
    doc_ids: result.doc_ids || [],
    category: (category as string) || '未分类',
    parent_category: (parent_category as string) || null,
    status: 'active',
    chunk_count: result.doc_ids?.length || 0,
    image_url: image_url || null,
  });

  if (dbError) {
    console.error('保存知识库条目失败:', dbError);
    return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
  }

  return apiSuccess({ doc_ids: result.doc_ids });
});
