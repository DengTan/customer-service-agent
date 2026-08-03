import { parseJsonBody, apiSuccess } from '@/lib/api-utils';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';
import { QuickReplyService } from '@/server/services/quick-reply-service';

const service = new QuickReplyService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'quick_replies', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const scope = searchParams.get('scope');

    const replies = await service.listReplies({ category, search, scope });
    return apiSuccess({ replies });
  },
);

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'quick_replies', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody(request);
    if (parseError) return parseError;

    const reply = await service.createReply({
      title: body?.title as string,
      content: body?.content as string,
      category: body?.category as string,
      variables: body?.variables as unknown[],
      scope: body?.scope as string,
      creator_id: body?.creator_id as string,
    });
    return apiSuccess({ reply });
  },
);

export { POSTHandler as POST };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'quick_replies', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody(request);
    if (parseError) return parseError;

    const reply = await service.updateReply({
      id: body?.id as string,
      title: body?.title as string,
      content: body?.content as string,
      category: body?.category as string,
      variables: body?.variables as unknown[],
      scope: body?.scope as string,
    });
    return apiSuccess({ reply });
  },
);

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'quick_replies', action: 'delete' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    await service.deleteReply(id!);
    return apiSuccess({ success: true });
  },
);

export { DELETEHandler as DELETE };