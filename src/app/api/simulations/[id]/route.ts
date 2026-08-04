import { apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { simulationRepository } from '@/server/repositories/simulation-repository';
import { canAccessConversation } from '@/lib/simulation-access';
import { GET as defineGet, DELETE as defineDelete } from '@/lib/api/with-api';

export const GET = defineGet(
  { auth: 'required', perm: { resource: 'conversations', action: 'read' } },
  async ({ request, user, params }) => {
    const { id } = params as { id: string };
    const userId = user?.sub ?? undefined;
    const role = user?.role ?? undefined;

    const simulation = await simulationRepository.getById(id);

    if (!simulation) {
      return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
    }

    if (!canAccessConversation(simulation, userId ?? null, role ?? null)) {
      return apiError('无权限查看此会话', { status: HttpStatus.FORBIDDEN });
    }

    const messages = await simulationRepository.listMessages(id);

    return apiSuccess({
      conversation: simulation,
      messages,
    });
  },
);

export const DELETE = defineDelete(
  { auth: 'required', perm: { resource: 'conversations', action: 'delete' } },
  async ({ request, user, params }) => {
    const { id } = params as { id: string };
    const userId = user?.sub ?? undefined;
    const role = user?.role ?? undefined;

    if (!userId) {
      return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
    }

    const simulation = await simulationRepository.getById(id);
    if (!simulation) {
      return apiError('模拟会话不存在', { status: HttpStatus.NOT_FOUND });
    }

    const isCreator = simulation.created_by !== null &&
                      simulation.created_by !== undefined &&
                      simulation.created_by === userId;
    const isAdmin = role === 'admin';

    if (!isCreator && !isAdmin) {
      return apiError('无权限删除此会话', { status: HttpStatus.FORBIDDEN });
    }

    const deleted = await simulationRepository.delete(id);

    if (!deleted) {
      return apiError('删除失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
    }

    return apiSuccess({ success: true });
  },
);
