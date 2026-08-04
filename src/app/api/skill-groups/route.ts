import { parseJsonBody, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { GET, POST, PATCH, DELETE } from '@/lib/api/with-api';
import { SkillGroupService } from '@/server/services/skill-group-service';
import { z } from 'zod';

const service = new SkillGroupService();

// Zod schema for skill group validation
const SkillGroupSchema = z.object({
  name: z.string().min(1, '技能组名称不能为空').max(100),
  description: z.string().nullable().optional(),
  member_ids: z.array(z.string()).optional().default([]),
  is_default: z.boolean().optional().default(false),
});

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async () => {
    const groups = await service.listGroups();
    return apiSuccess({ groups });
  },
);

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody(request);
    if (parseError) return parseError;

    const validation = SkillGroupSchema.safeParse(body);
    if (!validation.success) {
      return apiError(validation.error.issues[0]?.message || '输入格式不正确', { status: HttpStatus.BAD_REQUEST });
    }

    const group = await service.createGroup({
      name: validation.data.name,
      description: validation.data.description ?? null,
      member_ids: validation.data.member_ids,
      is_default: validation.data.is_default,
    });
    return apiSuccess({ group });
  },
);

export { POSTHandler as POST };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody(request);
    if (parseError) return parseError;

    const validation = SkillGroupSchema.extend({ id: z.string().min(1, '技能组ID不能为空') }).safeParse(body);
    if (!validation.success) {
      return apiError(validation.error.issues[0]?.message || '输入格式不正确', { status: HttpStatus.BAD_REQUEST });
    }

    const group = await service.updateGroup({
      id: validation.data.id,
      name: validation.data.name,
      description: validation.data.description ?? null,
      member_ids: validation.data.member_ids,
      is_default: validation.data.is_default,
    });
    return apiSuccess({ group });
  },
);

export { PATCHHandler as PATCH };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'delete' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('缺少ID参数', { status: HttpStatus.BAD_REQUEST });
    }

    await service.deleteGroup(id);
    return apiSuccess({ success: true });
  },
);

export { DELETEHandler as DELETE };