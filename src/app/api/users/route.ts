import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requireRole, parseJsonBody, getAuthenticatedUserId } from '@/lib/api-utils';
import { UserService } from '@/server/services/user-service';
import type { UpdateUserInput } from '@/server/repositories/user-repository';

const userService = new UserService();

const ADMIN_ONLY = ['admin'];
const ADMIN_AGENT = ['admin', 'agent'];

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_AGENT);
  if (forbidden) return forbidden;

  const { searchParams } = new URL(request.url);
  const filters = {
    role: searchParams.get('role') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  };
  const result = await userService.listUsers(filters);
  return apiSuccess({ users: result.users, total: result.total });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

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
  return apiSuccess(result, 201);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody<{
    id?: string;
    ids?: string[];
    role?: string;
    status?: string;
    name?: string;
    avatar?: string | null;
  }>(request);
  if (parseError) return parseError;

  // Batch update status for multiple users
  if (body?.ids && Array.isArray(body.ids) && body.status) {
    const currentUserId = getAuthenticatedUserId(request);
    // Filter out current user from batch update
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

  // Single user update
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

  const user = await userService.updateUser(updates);
  return apiSuccess({ user });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const currentUserId = getAuthenticatedUserId(request);
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get('id') || '';
  const idsParam = searchParams.get('ids') || '';

    // Batch deletion
  if (idsParam) {
    const ids = idsParam.split(',').filter(Boolean);
    // Filter out current user first
    const idsToDelete = ids.filter(id => id !== currentUserId);

    // Check for last admin protection via service layer
    try {
      const result = await userService.deleteUsers(idsToDelete);
      return apiSuccess({ success: true, deleted: result.deleted, protected: result.protected });
    } catch (error) {
      // Re-throw service errors (like LAST_ADMIN_PROTECTION)
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

  // Single deletion
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
    return apiSuccess({ success: true });
  } catch (error) {
    // Handle LAST_ADMIN_PROTECTION error
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
});
