import { NextRequest } from 'next/server';
import { PushService } from '@/server/services/push-service';
import { parseJsonBody, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';

const pushService = new PushService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'read' },
  },
  async () => {
  const result = await pushService.listTemplates();
  return apiSuccess({ templates: result.templates });
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'write' },
  },
  async ({ request }) => {
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
}, );

export { POSTHandler as POST };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'write' },
  },
  async ({ request }) => {
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
}, );

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'push', action: 'delete' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('模板ID不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  await pushService.deleteTemplate(id);
  return apiSuccess({});
}, );

export { DELETEHandler as DELETE };
