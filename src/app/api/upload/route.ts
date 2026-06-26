import { NextRequest } from 'next/server';
import { extname } from 'path';
import { S3Storage } from 'coze-coding-dev-sdk';
import { apiError, apiSuccess, HttpStatus, withErrorHandlerSimple, checkRateLimit } from '@/lib/api-utils';
import { HTTP } from '@/lib/constants';

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

// Allowed image extensions (case-insensitive)
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Allowed MIME types
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // Rate limit: 30 uploads per minute per IP
  const rateLimitError = checkRateLimit(request, { maxRequests: 30, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  // purpose: 'chat' (default, 30-day URL) or 'knowledge' (365-day URL for long-lived references)
  const purpose = (formData.get('purpose') as string) || 'chat';

  if (!file) {
    return apiError('请选择要上传的文件', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  // Validate file extension (case-insensitive)
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return apiError(
      `不支持的文件扩展名：${ext || '无'}。仅支持 ${[...ALLOWED_EXTENSIONS].join('/')} 格式的图片`,
      { status: HttpStatus.BAD_REQUEST, code: 'INVALID_EXTENSION' }
    );
  }

  // Validate MIME type
  if (!ALLOWED_TYPES.has(file.type)) {
    return apiError('仅支持 JPG/PNG/GIF/WebP 格式的图片', { status: HttpStatus.BAD_REQUEST, code: 'INVALID_TYPE' });
  }

  // Validate file size (max 10MB)
  if (file.size > HTTP.MAX_UPLOAD_SIZE_BYTES) {
    return apiError('图片大小不能超过 10MB', { status: HttpStatus.BAD_REQUEST, code: 'FILE_TOO_LARGE' });
  }

  // Magic bytes validation (security: prevent polyglot file uploads)
  const buffer = Buffer.from(await file.arrayBuffer());
  const header = buffer.slice(0, 12);
  const isJpeg = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
  const isGif = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38;
  const isWebp = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
    && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
  if (!isJpeg && !isPng && !isGif && !isWebp) {
    return apiError('文件内容不是有效的图片格式', { status: HttpStatus.BAD_REQUEST, code: 'INVALID_CONTENT' });
  }

  // Use different storage paths based on purpose
  const safeExt = ext.replace('.', ''); // Strip leading dot for filename
  const folder = purpose === 'knowledge' ? 'knowledge-images' : 'chat-images';
  const fileName = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  const fileKey = await storage.uploadFile({
    fileContent: buffer,
    fileName,
    contentType: file.type,
  });

  // Knowledge images need longer-lived URLs (365 days) vs chat images (30 days)
  const expireTime = purpose === 'knowledge' ? 86400 * 365 : 86400 * 30;
  const imageUrl = await storage.generatePresignedUrl({
    key: fileKey,
    expireTime,
  });

  return apiSuccess({ url: imageUrl, key: fileKey });
});
