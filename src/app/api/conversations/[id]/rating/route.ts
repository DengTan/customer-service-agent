import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, HttpStatus, withErrorHandler } from '@/lib/api-utils';
import { ConversationService } from '@/server/services/conversation-service';
import { SettingsService } from '@/server/services/settings-service';

const conversationService = new ConversationService();

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  // Check if rating is enabled in settings
  try {
    const settingsService = new SettingsService();
    const settings = await settingsService.getSettingsMap();
    if (settings.rating_enabled === 'false') {
      return apiError('评价功能已关闭', { status: HttpStatus.FORBIDDEN, code: 'RATING_DISABLED' });
    }
  } catch (err) {
    // Settings lookup failed; allow rating by default
    console.error('[Rating API] Failed to check rating_enabled setting:', err);
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    rating?: number;
    comment?: string;
  }>(request);
  if (parseError) return parseError;

  const conversation = await conversationService.rateConversation(id, body?.rating, body?.comment);
  return apiSuccess({ conversation });
});
