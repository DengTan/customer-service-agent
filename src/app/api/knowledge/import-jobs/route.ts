import { NextRequest } from 'next/server';
import { knowledgeImportService } from '@/server/services/knowledge-import-service';
import { apiError, apiSuccess, HttpStatus, withErrorHandlerSimple, checkRateLimit } from '@/lib/api-utils';
import { getAuthenticatedUserId } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * 创建导入任务
 * POST /api/knowledge/import-jobs
 * 
 * Body: FormData
 * - file: File (必需)
 * - name: string (可选，默认使用文件名)
 * - category: string (可选，默认"未分类")
 * - parent_category: string (可选)
 * - image_url: string (可选)
 */
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  // 速率限制
  const rateLimitError = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 });
  if (rateLimitError) return rateLimitError;

  // 获取当前用户 ID
  const userId = await getAuthenticatedUserId(request);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return apiError('请使用 multipart/form-data 格式上传文件', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return apiError('请选择要上传的文件', {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }

    const name = (formData.get('name') as string) || undefined;
    const category = (formData.get('category') as string) || undefined;
    const parentCategory = (formData.get('parent_category') as string) || undefined;
    const imageUrl = (formData.get('image_url') as string) || undefined;
    const description = (formData.get('description') as string) || undefined;

    const { jobId } = await knowledgeImportService.createJob({
      file,
      name,
      category,
      parentCategory,
      imageUrl,
      description,
      userId: userId || undefined,
    });

    logger.api.info('import-job-created', { jobId, fileName: file.name, userId });

    return apiSuccess({ job_id: jobId, status: 'pending' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建导入任务失败';
    
    // 特定错误码处理
    if (message.includes('内容重复')) {
      return apiError(message, {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE_CONTENT',
      });
    }
    if (message.includes('不支持的文件格式')) {
      return apiError(message, {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }
    if (message.includes('文件大小超过限制')) {
      return apiError(message, {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }

    return apiError(message, {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'IMPORT_ERROR',
    });
  }
});

/**
 * 获取用户进行中的导入任务
 * GET /api/knowledge/import-jobs
 */
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = await getAuthenticatedUserId(request);

  const jobs = await knowledgeImportService.getActiveJobs(userId || undefined);

  return apiSuccess({ jobs });
});
