import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, apiError, HttpStatus, requireRole, parseJsonBody } from '@/lib/api-utils';
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
  }>(request);
  if (parseError) return parseError;

  const email = body?.email || '';
  const name = body?.name || '';
  const role = body?.role || 'agent';
  const avatar = body?.avatar ?? null;

  const user = await userService.createUser({ email, name, role, avatar });
  return apiSuccess({ user }, 201);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const { data: body, error: parseError } = await parseJsonBody<{
    id?: string;
    role?: string;
    status?: string;
    name?: string;
    avatar?: string | null;
  }>(request);
  if (parseError) return parseError;

  const id = body?.id || '';
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

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  await userService.deleteUser(id);
  return apiSuccess({ success: true });
});
