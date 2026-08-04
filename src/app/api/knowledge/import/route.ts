/**
 * POST /api/knowledge/import
 * Knowledge import API - supports file upload and JSON body
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/lib/logger';
import { createHash } from 'crypto';
import { getEmbeddingService } from '@/server/services/embedding-service';
import { chunkText } from '@/server/services/text-chunker';
import { randomUUID } from 'crypto';
import { withApi } from '@/lib/api/with-api';

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'smartassist';

const ALLOWED_EXTENSIONS = [
  '.xlsx', '.xls', '.csv',
  '.pdf', '.docx', '.doc',
  '.md', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
];
const MIME_MAP: Record<string, string> = {
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

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const KNOWLEDGE_IMAGE_EXPIRE_SECONDS = 365 * 24 * 60 * 60;

function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

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

async function safeDeleteFile(storagePath: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch (err) {
    logger.warn('文件清理失败', { storagePath, error: err });
  }
}

async function insertAndGetId(
  supabase: ReturnType<typeof getSupabaseClient>,
  row: Record<string, unknown>
): Promise<{ id: string } | null> {
  const { data, error } = await supabase.from('knowledge_items').insert(row).select('id').single();
  if (error) throw error;
  return data as { id: string } | null;
}

async function generateSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  return data?.signedUrl || '';
}

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

  if (error) throw new Error(`文件上传失败: ${error.message}`);
  return data.path;
}

export const POST = withApi(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  },
  async ({ request }) => {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const name = (formData.get('name') as string) || '';
      const category = (formData.get('category') as string) || '未分类';
      const parentCategory = (formData.get('parent_category') as string) || null;
      const imageUrl = (formData.get('image_url') as string) || null;

      if (!file) {
        return new Response(JSON.stringify({ ok: false, error: '请选择要上传的文件', code: 'VALIDATION_ERROR' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const ext = getExtension(file.name);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return new Response(JSON.stringify({ ok: false, error: `不支持的文件格式，仅支持 ${ALLOWED_EXTENSIONS.join('、')} 文件`, code: 'VALIDATION_ERROR' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (file.size > MAX_FILE_SIZE) {
        return new Response(JSON.stringify({ ok: false, error: '文件大小超过限制（最大 20MB）', code: 'VALIDATION_ERROR' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const displayName = name || file.name;
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
      const existingName = await findDuplicateByHash(contentHash);
      if (existingName) {
        return new Response(JSON.stringify({ ok: false, error: `内容重复：已存在相同内容的条目「${existingName}」，请勿重复导入`, code: 'DUPLICATE_CONTENT' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const isImage = IMAGE_EXTENSIONS.has(ext);
      const description = ((formData.get('description') as string) || '').trim();
      const needsEmbedding = !isImage || (isImage && description);
      const embeddingService = getEmbeddingService();
      if (needsEmbedding && !(await embeddingService.isAvailable())) {
        return new Response(JSON.stringify({ ok: false, error: '向量化服务不可用，请确认 Ollama 已启动', code: 'EMBEDDING_UNAVAILABLE' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now();
      const storagePath = `knowledge/${timestamp}_${safeFileName}`;
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';

      let uploadedPath: string;
      try {
        uploadedPath = await uploadToStorage(fileBuffer, storagePath, mimeType);
      } catch (uploadError) {
        logger.agent.error('文件上传失败', { error: uploadError });
        return new Response(JSON.stringify({ ok: false, error: '文件上传失败', code: 'UPLOAD_FAILED' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (isImage) {
        let imageSignedUrl: string;
        try {
          imageSignedUrl = await generateSignedUrl(uploadedPath, KNOWLEDGE_IMAGE_EXPIRE_SECONDS);
        } catch {
          const supabase = getSupabaseClient();
          const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(uploadedPath);
          imageSignedUrl = urlData.publicUrl;
        }

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
          return new Response(JSON.stringify({ ok: true, image_url: imageSignedUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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
          return new Response(JSON.stringify({ ok: false, error: '保存知识库条目失败', code: 'DB_ERROR' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, image_url: imageSignedUrl }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let contentText = '';
      try {
        const { extractTextFromBuffer, getFileType } = await import('@/server/services/text-extractor');
        const fileType = getFileType(file.name);
        contentText = await extractTextFromBuffer(fileBuffer, fileType);
        if (!contentText.trim()) {
          contentText = file.name;
        }
      } catch (parseError) {
        logger.agent.warn('File content extraction failed', { fileName: file.name, error: parseError });
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
        return new Response(JSON.stringify({ ok: false, error: '保存知识库条目失败', code: 'DB_ERROR' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const newItemId = (insertedItem as { id: string } | null)?.id;
      if (chunkCount > 0 && newItemId) {
        await supabase.from('knowledge_chunks').insert(
          chunks.map(c => ({
            id: randomUUID(),
            knowledge_item_id: newItemId,
            chunk_index: c.index,
            content: c.content,
            content_hash: c.content_hash,
            version_added: 1,
          }))
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // JSON body branch
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: '请求体无效' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { type, content, url, name, category, parent_category, image_url } = body;

    const dedupContent = type === 'text' ? (content as string) : type === 'image' ? (image_url as string) : (url as string);
    if (dedupContent) {
      const contentHash = computeContentHash(dedupContent);
      const existingName = await findDuplicateByHash(contentHash);
      if (existingName) {
        return new Response(JSON.stringify({ ok: false, error: `内容重复：已存在相同内容的条目「${existingName}」，请勿重复导入`, code: 'DUPLICATE_CONTENT' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const embeddingService = getEmbeddingService();
    let documents: { content: string; type: string } | null = null;

    if (type === 'text') {
      if (!content) {
        return new Response(JSON.stringify({ ok: false, error: '文本内容不能为空', code: 'VALIDATION_ERROR' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      documents = { content: content as string, type: type as string };
    } else if (type === 'url') {
      if (!url) {
        return new Response(JSON.stringify({ ok: false, error: 'URL不能为空', code: 'VALIDATION_ERROR' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      documents = { content: url as string, type: type as string };
    } else if (type === 'image') {
      if (!image_url) {
        return new Response(JSON.stringify({ ok: false, error: '图片类型必须提供 image_url', code: 'VALIDATION_ERROR' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const description = ((content as string) || '').trim();
      if (description) {
        documents = { content: description, type: type as string };
      } else {
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
          return new Response(JSON.stringify({ ok: false, error: '保存知识库条目失败', code: 'DB_ERROR' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      return new Response(JSON.stringify({ ok: false, error: '不支持的导入类型', code: 'VALIDATION_ERROR' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const textChunks = chunkText(documents.content);
    const textChunkCount = textChunks.length;
    const embedding = await embeddingService.embed(documents.content);

    const displayName = (name as string) || (type === 'text' ? '导入文本' : type === 'image' ? '导入图片' : '导入网页');
    const supabase = getSupabaseClient();
    const finalContentHash = dedupContent ? computeContentHash(dedupContent as string) : null;
    const { error: dbError, data: insertedItem } = await supabase.from('knowledge_items').insert({
      name: displayName,
      type,
      content: documents.content,
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
      return new Response(JSON.stringify({ ok: false, error: '保存知识库条目失败', code: 'DB_ERROR' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
);
