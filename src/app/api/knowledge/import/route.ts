import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple, checkRateLimit } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { createHash } from 'crypto';
import { getEmbeddingService } from '@/server/services/embedding-service';
import { chunkText } from '@/server/services/text-chunker';
import { randomUUID } from 'crypto';

// Supabase Storage bucket name
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'smartassist';

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

// Knowledge image URL expiry: 365 days (in seconds)
const KNOWLEDGE_IMAGE_EXPIRE_SECONDS = 365 * 24 * 60 * 60;

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

/**
 * Safe delete from Supabase Storage (best-effort, does not affect main error).
 * Use case: file uploaded → subsequent steps (vectorization/DB write) fail,
 * clean up uploaded file to prevent storage leak.
 */
async function safeDeleteFile(storagePath: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch (err) {
    // best-effort, delete failure does not affect main error
    // but log it so orphaned files can be traced
    logger.warn('文件清理失败，文件可能孤立', { storagePath, error: err });
  }
}

/**
 * Insert a knowledge item and return the inserted id.
 * Throws on DB error; caller is responsible for cleanup.
 */
async function insertAndGetId(
  supabase: ReturnType<typeof getSupabaseClient>,
  row: Record<string, unknown>
): Promise<{ id: string } | null> {
  const { data, error } = await supabase.from('knowledge_items').insert(row).select('id').single();
  if (error) {
    throw error;
  }
  return data as { id: string } | null;
}

/**
 * Generate a signed URL for the given storage path with the specified expiry.
 */
async function generateSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  return data?.signedUrl || '';
}

/**
 * Upload file to Supabase Storage.
 * Returns the storage path on success, throws on failure.
 */
async function uploadToStorage(
  buffer: Buffer,
  storagePath: string,
  contentType: string
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`文件上传失败: ${error.message}`);
  }

  // Return the storage path (data.path)
  return data.path;
}

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // Rate limit: 10 imports per minute per IP
  const rateLimitError = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  const contentType = request.headers.get('content-type') || '';

  // --- multipart/form-data branch ---
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = (formData.get('name') as string) || '';
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

    const displayName = name || file.name;

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

    // 2. Check Ollama availability for files that need embedding
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const description = ((formData.get('description') as string) || '').trim();
    const needsEmbedding = !isImage || (isImage && description);
    const embeddingService = getEmbeddingService();
    if (needsEmbedding && !(await embeddingService.isAvailable())) {
      return apiError('向量化服务不可用，请确认 Ollama 已启动', {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'EMBEDDING_UNAVAILABLE',
      });
    }

    // 3. Upload file to Supabase Storage
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const storagePath = `knowledge/${timestamp}_${safeFileName}`;
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';

    let uploadedPath: string;
    try {
      uploadedPath = await uploadToStorage(fileBuffer, storagePath, mimeType);
    } catch (uploadError) {
      logger.agent.error('文件上传失败', { error: uploadError });
      return apiError('文件上传失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'UPLOAD_FAILED' });
    }

    if (isImage) {
      // Image files: generate long-lived signed URL, store as type='image'
      // Images cannot be vectorized by the knowledge SDK, so we only store the reference
      let imageSignedUrl: string;
      try {
        imageSignedUrl = await generateSignedUrl(uploadedPath, KNOWLEDGE_IMAGE_EXPIRE_SECONDS);
      } catch {
        // If signed URL generation fails, try public URL as fallback
        const supabase = getSupabaseClient();
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(uploadedPath);
        imageSignedUrl = urlData.publicUrl;
      }

      // If a description text was provided, vectorize it (Ollama availability was checked above)
      if (description) {
        const imageEmbedding = await embeddingService.embed(description);
        const imageChunks = chunkText(description);
        const imageChunkCount = imageChunks.length;
        const supabase = getSupabaseClient();
        const newItemId = await insertAndGetId(supabase, {
          name: displayName,
          type: 'image',
          content: description.slice(0, 500) || file.name,
          content_hash: contentHash,
          category,
          parent_category: parentCategory,
          status: 'active',
          chunk_count: imageChunkCount,
          image_url: imageSignedUrl,
          embedding: imageEmbedding && imageEmbedding.length > 0 ? JSON.stringify(imageEmbedding) : null,
        });
        if (imageChunkCount > 0 && newItemId) {
          await supabase.from('knowledge_chunks').insert(
            imageChunks.map(c => ({
              knowledge_item_id: newItemId.id,
              chunk_index: c.index,
              content: c.content,
              content_hash: c.content_hash,
              version_added: 1,
            }))
          );
        }
        return apiSuccess({ image_url: imageSignedUrl });
      }

      // No description — just store the image reference directly
      const supabase = getSupabaseClient();
      const { error: dbError } = await supabase.from('knowledge_items').insert({
        name: displayName,
        type: 'image',
        content: file.name,
        content_hash: contentHash,
        category,
        parent_category: parentCategory,
        status: 'active',
        chunk_count: 0,
        image_url: imageSignedUrl,
        embedding: null,
      });
      if (dbError) {
        await safeDeleteFile(uploadedPath);
        logger.agent.error('保存知识库条目失败', { error: dbError });
        return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
      }
        return apiSuccess({ image_url: imageSignedUrl });
    }

    // 4. Non-image: Local embedding (Ollama availability already verified above)
    // Parse file content for all file types (not just txt/md)
    let contentText = '';

    try {
      const { extractTextFromBuffer, getFileType } = await import('@/server/services/text-extractor');
      const fileType = getFileType(file.name);
      contentText = await extractTextFromBuffer(fileBuffer, fileType);
      if (!contentText.trim()) {
        contentText = file.name; // Fallback to filename if extraction yields empty
      }
    } catch (parseError) {
      logger.agent.warn('File content extraction failed, using filename', { fileName: file.name, error: parseError });
      contentText = file.name;
    }

    const chunks = chunkText(contentText);
    const chunkCount = chunks.length;

    const embedding = await embeddingService.embed(contentText);

    const supabase = getSupabaseClient();
    const { error: dbError, data: insertedItem } = await supabase.from('knowledge_items').insert({
      name: displayName,
      type: 'file',
      content: contentText,
      content_hash: contentHash,
      category,
      parent_category: parentCategory,
      status: 'active',
      chunk_count: chunkCount,
      image_url: imageUrl,
      embedding: embedding && embedding.length > 0 ? JSON.stringify(embedding) : null,
    });

    if (dbError) {
      await safeDeleteFile(uploadedPath);
      logger.agent.error('保存知识库条目失败', { error: dbError });
      return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
    }

    const newItemId = (insertedItem as { id: string } | null)?.id;
    if (chunkCount > 0 && newItemId) {
      await supabase.from('knowledge_chunks').insert(
        chunks.map(c => ({
          id: randomUUID(),  // Generate UUID for primary key
          knowledge_item_id: newItemId,
          chunk_index: c.index,
          content: c.content,
          content_hash: c.content_hash,
          version_added: 1,
        }))
      );
    }

    return apiSuccess({});
  }

  // --- JSON body branch ---
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

  const embeddingService = getEmbeddingService();

  let documents: { content: string; type: string } | null = null;

  if (type === 'text') {
    if (!content) {
      return apiError('文本内容不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }
    documents = { content: content as string, type };
  } else if (type === 'url') {
    if (!url) {
      return apiError('URL不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }
    documents = { content: url as string, type };
  } else if (type === 'image') {
    // Image type: only stores image_url reference, optionally vectorizes description
    if (!image_url) {
      return apiError('图片类型必须提供 image_url', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    const description = ((content as string) || '').trim();
    if (description) {
      documents = { content: description, type };
    } else {
      // No description to vectorize — just store the image reference
      const supabase = getSupabaseClient();
      const { error: dbError } = await supabase.from('knowledge_items').insert({
        name: (name as string) || '导入图片',
        type: 'image',
        content: image_url as string,
        content_hash: dedupContent ? computeContentHash(dedupContent as string) : null,
        category: (category as string) || '未分类',
        parent_category: (parent_category as string) || null,
        status: 'active',
        chunk_count: 0,
        image_url: image_url as string,
      });

      if (dbError) {
        logger.agent.error('保存知识库条目失败', { error: dbError });
        return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
      }

      return apiSuccess({});
    }
  } else {
    return apiError('不支持的导入类型', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  // Vectorize with Ollama
  const textChunks = chunkText(documents!.content);
  const textChunkCount = textChunks.length;
  const embedding = await embeddingService.embed(documents!.content);

  // Track the imported item in database
  const displayName = (name as string) || (type === 'text' ? '导入文本' : type === 'image' ? '导入图片' : '导入网页');
  const supabase = getSupabaseClient();
  const finalContentHash = dedupContent ? computeContentHash(dedupContent as string) : null;
  const { error: dbError, data: insertedItem } = await supabase.from('knowledge_items').insert({
    name: displayName,
    type,
    content: documents!.content,
    content_hash: finalContentHash,
    category: (category as string) || '未分类',
    parent_category: (parent_category as string) || null,
    status: 'active',
    chunk_count: textChunkCount,
    image_url: image_url || null,
    embedding: embedding && embedding.length > 0 ? JSON.stringify(embedding) : null,
  });

  if (dbError) {
    logger.agent.error('保存知识库条目失败', { error: dbError });
    return apiError('保存知识库条目失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: dbError.message, code: 'DB_ERROR' });
  }

  const newItemId = (insertedItem as { id: string } | null)?.id;
  if (textChunkCount > 0 && newItemId) {
    await supabase.from('knowledge_chunks').insert(
      textChunks.map(c => ({
        knowledge_item_id: newItemId,
        chunk_index: c.index,
        content: c.content,
        content_hash: c.content_hash,
        version_added: 1,
      }))
    );
  }

  return apiSuccess({});
});
