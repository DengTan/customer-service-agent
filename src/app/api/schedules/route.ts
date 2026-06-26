import { NextRequest } from 'next/server';
import { parseJsonBody, withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { ScheduleService } from '@/server/services/schedule-service';

const service = new ScheduleService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const user_id = searchParams.get('user_id');
  const skill_group_id = searchParams.get('skill_group_id');

  const schedules = await service.listSchedules({ date, user_id, skill_group_id });
  return apiSuccess({ schedules });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const items = body?.items as Array<{
    user_id: string;
    skill_group_id: string;
    date: string;
    shift: string;
  }>;

  const schedules = await service.createSchedules(items);
  return apiSuccess({ schedules });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  await service.deleteSchedule(id!);
  return apiSuccess({ success: true });
});
