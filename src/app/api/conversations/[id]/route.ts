import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, requirePermission } from '@/lib/api-utils';
import { GET, PATCH, DELETE } from '@/lib/api/with-api';
import { ConversationService } from '@/server/services/conversation-service';
import { SettingsService } from '@/server/services/settings-service';
import { logger } from '@/lib/logger';

const conversationService = new ConversationService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'read' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };
  const { searchParams } = new URL(request.url);
  const messageLimit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const messagePage = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
  const messageOffset = parseInt(searchParams.get('offset') || '0', 10);
  const messageOrder = searchParams.get('order') === 'desc' ? 'desc' : 'asc';

  const detail = await conversationService.getConversationDetail(id, messageLimit, messagePage, messageOffset, messageOrder);

  let ratingEnabled = true;
  try {
    const settings = await new SettingsService().getSettingsMap();
    if (settings.rating_enabled === 'false') {
      ratingEnabled = false;
    }
  } catch (err) {
    logger.api.warn('[ConversationDetail] Failed to read rating_enabled setting', { error: err, conversationId: id });
  }

  return apiSuccess({ ...detail, capabilities: { rating_enabled: ratingEnabled } });
}, );

export { GETHandler as GET };

export const PATCHHandler = PATCH(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'write' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  await conversationService.updateConversation(id, body ?? {});
  return apiSuccess({ success: true });
}, );

export { PATCHHandler as PATCH };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'conversations', action: 'delete' },
  },
  async ({ params }) => {
  const { id } = params as { id: string };
  await conversationService.deleteConversation(id);
  return apiSuccess({ success: true });
}, );

export { DELETEHandler as DELETE };
