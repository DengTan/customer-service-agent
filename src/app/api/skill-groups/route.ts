import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { SkillGroupService } from '@/server/services/skill-group-service';

const service = new SkillGroupService();

export const GET = withErrorHandlerSimple(async () => {
  const groups = await service.listGroups();
  return apiSuccess({ groups });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const group = await service.createGroup({
    name: body?.name as string,
    description: body?.description as string | null,
    member_ids: body?.member_ids as string[],
    is_default: body?.is_default as boolean,
  });
  return apiSuccess({ group });
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const group = await service.updateGroup({
    id: body?.id as string,
    name: body?.name as string,
    description: body?.description as string | null,
    member_ids: body?.member_ids as string[],
    is_default: body?.is_default as boolean,
  });
  return apiSuccess({ group });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  await service.deleteGroup(id!);
  return apiSuccess({ success: true });
});
