import { NextRequest } from 'next/server';
import { PushService } from '@/server/services/push-service';
import { parseJsonBody, apiSuccess, apiError, withErrorHandlerSimple, HttpStatus } from '@/lib/api-utils';

const pushService = new PushService();

export const GET = withErrorHandlerSimple(async () => {
  const result = await pushService.listTemplates();
  return apiSuccess({ templates: result.templates });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<{
    name: string;
    trigger_event: string;
    content_template: string;
    channels?: string[];
    is_enabled?: boolean;
  }>(request);
  if (parseError) return parseError;

  const result = await pushService.createTemplate(body!);
  return apiSuccess({ template: result.template });
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody<{
    id: string;
    name?: string;
    trigger_event?: string;
    content_template?: string;
    channels?: string[];
    is_enabled?: boolean;
  }>(request);
  if (parseError) return parseError;

  const result = await pushService.updateTemplate(body!);
  return apiSuccess({ template: result.template });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('模板ID不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  await pushService.deleteTemplate(id);
  return apiSuccess({});
});
