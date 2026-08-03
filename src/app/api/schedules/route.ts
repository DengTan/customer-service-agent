import { parseJsonBody, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { GET, POST, DELETE } from '@/lib/api/with-api';
import { ScheduleService } from '@/server/services/schedule-service';
import { z } from 'zod';

const service = new ScheduleService();

// Zod schema for schedule item validation
const ScheduleItemSchema = z.object({
  user_id: z.string().min(1, '用户ID不能为空'),
  skill_group_id: z.string().min(1, '技能组ID不能为空'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为YYYY-MM-DD'),
  shift: z.string().min(1, '班次不能为空'),
});

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const user_id = searchParams.get('user_id');
    const skill_group_id = searchParams.get('skill_group_id');

    const schedules = await service.listSchedules({ date, user_id, skill_group_id });
    return apiSuccess({ schedules });
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

    const itemsRaw = body?.items as Array<Record<string, unknown>> | undefined;
    if (!itemsRaw || !Array.isArray(itemsRaw) || itemsRaw.length === 0) {
      return apiError('请提供有效的排班数据', { status: HttpStatus.BAD_REQUEST });
    }

    const validation = z.array(ScheduleItemSchema).safeParse(itemsRaw);
    if (!validation.success) {
      return apiError(validation.error.issues[0]?.message || '排班数据格式不正确', { status: HttpStatus.BAD_REQUEST });
    }

    const schedules = await service.createSchedules(validation.data);
    return apiSuccess({ schedules });
  },
);

export { POSTHandler as POST };

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

    await service.deleteSchedule(id);
    return apiSuccess({ success: true });
  },
);

export { DELETEHandler as DELETE };