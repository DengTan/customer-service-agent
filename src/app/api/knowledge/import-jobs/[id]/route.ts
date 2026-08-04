import { GET as defineGet, DELETE as defineDelete } from '@/lib/api/with-api';
import { knowledgeImportService } from '@/server/services/knowledge-import-service';
import { logger } from '@/lib/logger';

/**
 * 获取导入任务状态
 * GET /api/knowledge/import-jobs/[id]
 */
export const GET = defineGet(
  { auth: 'required', perm: { resource: 'knowledge', action: 'read' } },
  async ({ params, user }) => {
    const { id } = (await params) as { id: string };
    const userId = user?.sub as string;

    const job = await knowledgeImportService.getJobStatus(id, userId);

    if (!job) {
      return Response.json(
        { error: '导入任务不存在', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return Response.json(job);
  },
);

/**
 * 删除导入任务
 * DELETE /api/knowledge/import-jobs/[id]
 */
export const DELETE = defineDelete(
  { auth: 'required', perm: { resource: 'knowledge', action: 'delete' } },
  async ({ params, user }) => {
    const { id } = (await params) as { id: string };
    const userId = user?.sub as string;

    const job = await knowledgeImportService.getJobStatus(id, userId);

    if (!job) {
      return Response.json(
        { error: '导入任务不存在', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // 只能删除已完成或失败的任务
    if (job.status === 'pending' || job.status === 'processing') {
      return Response.json(
        { error: '无法删除进行中的任务', code: 'INVALID_STATUS' },
        { status: 400 },
      );
    }

    await knowledgeImportService.deleteJob(id);

    logger.api.info('import-job-deleted', { jobId: id });

    return Response.json({ message: '删除成功' });
  },
);
