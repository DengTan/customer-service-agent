import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, withErrorHandler, requirePermission } from '@/lib/api-utils';
import { ConversationService } from '@/server/services/conversation-service';
import { SettingsService } from '@/server/services/settings-service';
import { logger } from '@/lib/logger';

const conversationService = new ConversationService();

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await requirePermission(request, 'conversations', 'read');
  if (denied) return denied;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const messageLimit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const messagePage = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
  const messageOffset = parseInt(searchParams.get('offset') || '0', 10);
  const messageOrder = searchParams.get('order') === 'desc' ? 'desc' : 'asc';

  const detail = await conversationService.getConversationDetail(id, messageLimit, messagePage, messageOffset, messageOrder);

  // Phase 4: Surface minimal per-conversation capabilities so the chat page
  // can avoid reading the admin-only /api/settings endpoint.
  // rating_enabled defaults to true when the setting is missing or unreadable
  // — preserving the prior behaviour where the rating UI was always shown.
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
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  // Fine-grained permission check
  const denied = await requirePermission(request, 'conversations', 'write');
  if (denied) return denied;

  const { id } = await params;
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  await conversationService.updateConversation(id, body ?? {});
  return apiSuccess({ success: true });
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  // Fine-grained permission check
  const denied = await requirePermission(request, 'conversations', 'delete');
  if (denied) return denied;

  const { id } = await params;

  await conversationService.deleteConversation(id);
  return apiSuccess({ success: true });
});
