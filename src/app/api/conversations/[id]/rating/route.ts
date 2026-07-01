import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, HttpStatus, withErrorHandler } from '@/lib/api-utils';
import { ConversationService } from '@/server/services/conversation-service';
import { SettingsService } from '@/server/services/settings-service';
import { logger } from '@/lib/logger';

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
    logger.api.warn('[Rating API] Failed to check rating_enabled setting', { error: err, conversationId: id });
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    rating?: number;
    comment?: string;
  }>(request);
  if (parseError) return parseError;

  // Validate rating: must be 1-5, rating=0 is treated as invalid
  const rating = body?.rating;
  if (!rating || rating < 1 || rating > 5) {
    return apiError('评分必须在 1-5 之间', { status: 400 });
  }

  const conversation = await conversationService.rateConversation(id, rating, body?.comment);
  return apiSuccess({ conversation });
});
