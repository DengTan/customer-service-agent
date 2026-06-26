import { NextRequest } from 'next/server';
import { knowledgeImportService } from '@/server/services/knowledge-import-service';
import { apiError, apiSuccess, HttpStatus, withErrorHandler, getAuthenticatedUserId } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * 获取导入任务状态
 * GET /api/knowledge/import-jobs/[id]
 */
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const userId = getAuthenticatedUserId(request);

  const job = await knowledgeImportService.getJobStatus(id, userId);

  if (!job) {
    return apiError('导入任务不存在', {
      status: HttpStatus.NOT_FOUND,
      code: 'NOT_FOUND',
    });
  }

  return apiSuccess(job);
});

/**
 * 删除导入任务
 * DELETE /api/knowledge/import-jobs/[id]
 */
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const userId = getAuthenticatedUserId(request);

  const job = await knowledgeImportService.getJobStatus(id, userId);

  if (!job) {
    return apiError('导入任务不存在', {
      status: HttpStatus.NOT_FOUND,
      code: 'NOT_FOUND',
    });
  }

  // 只能删除已完成或失败的任务
  if (job.status === 'pending' || job.status === 'processing') {
    return apiError('无法删除进行中的任务', {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_STATUS',
    });
  }

  await knowledgeImportService.deleteJob(id);

  logger.api.info('import-job-deleted', { jobId: id });

  return apiSuccess({ message: '删除成功' });
});
