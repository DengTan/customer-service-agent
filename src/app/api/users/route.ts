import { apiSuccess, apiError, HttpStatus, parseJsonBody } from '@/lib/api-utils';
import { GET, POST, PATCH, DELETE } from '@/lib/api/with-api';
import { UserService } from '@/server/services/user-service';
import type { UpdateUserInput } from '@/server/repositories/user-repository';

const userService = new UserService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const filters = {
      role: searchParams.get('role') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    };
    const result = await userService.listUsers(filters);
    return apiSuccess({ users: result.users, total: result.total });
  },
);

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      email?: string;
      name?: string;
      role?: string;
      avatar?: string | null;
      password?: string;
    }>(request);
    if (parseError) return parseError;

    const email = body?.email || '';
    const name = body?.name || '';
    const role = body?.role || 'agent';
    const avatar = body?.avatar ?? null;
    const password = body?.password;

    const result = await userService.createUser({ email, name, role, avatar, password });
    return apiSuccess(result, HttpStatus.CREATED);
  },
);

export { POSTHandler as POST };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'write' },
  },
  async ({ request, user }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      id?: string;
      ids?: string[];
      role?: string;
      status?: string;
      name?: string;
      avatar?: string | null;
    }>(request);
    if (parseError) return parseError;

    if (body?.ids && Array.isArray(body.ids) && body.status) {
      const currentUserId = user?.sub ?? null;
      const idsToUpdate = body.ids.filter(id => id !== currentUserId);
      if (idsToUpdate.length === 0) {
        return apiError('无法修改当前账号状态', {
          status: HttpStatus.FORBIDDEN,
          code: 'SELF_STATUS_CHANGE_FORBIDDEN',
        });
      }
      const result = await userService.updateUsersStatus(idsToUpdate, body.status);
      return apiSuccess({ updated: result.updated });
    }

    const id = body?.id || '';
    if (!id) {
      return apiError('缺少用户 ID', {
        status: HttpStatus.BAD_REQUEST,
        code: 'MISSING_USER_ID',
      });
    }
    const updates: UpdateUserInput = {
      id,
      role: body?.role,
      status: body?.status,
      name: body?.name,
      avatar: body?.avatar,
    };

    const userResult = await userService.updateUser(updates);
    return apiSuccess({ user: userResult });
  },
);

export { PATCHHandler as PATCH };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'delete' },
  },
  async ({ request, user }) => {
    const currentUserId = user?.sub ?? null;
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('id') || '';
    const idsParam = searchParams.get('ids') || '';

    if (idsParam) {
      const ids = idsParam.split(',').filter(Boolean);
      const idsToDelete = ids.filter(id => id !== currentUserId);

      try {
        const result = await userService.deleteUsers(idsToDelete);
        return apiSuccess({ success: true, deleted: result.deleted, protected: result.protected });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const err = error as { code?: string; message?: string };
          if (err.code === 'LAST_ADMIN_PROTECTION') {
            return apiError(err.message || '无法删除最后一个管理员', {
              status: HttpStatus.FORBIDDEN,
              code: 'LAST_ADMIN_PROTECTION',
            });
          }
        }
        throw error;
      }
    }

    if (!targetId) {
      return apiError('缺少用户 ID', {
        status: HttpStatus.BAD_REQUEST,
        code: 'MISSING_USER_ID',
      });
    }

    if (currentUserId && targetId === currentUserId) {
      return apiError('无法删除当前登录账号', {
        status: HttpStatus.FORBIDDEN,
        code: 'SELF_DELETE_FORBIDDEN',
      });
    }

    try {
      await userService.deleteUser(targetId);
      return apiSuccess({ success: true, deleted: [targetId], protected: [] });
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'LAST_ADMIN_PROTECTION') {
          return apiError(err.message || '无法删除最后一个管理员', {
            status: HttpStatus.FORBIDDEN,
            code: 'LAST_ADMIN_PROTECTION',
          });
        }
      }
      throw error;
    }
  },
);

export { DELETEHandler as DELETE };