import { NextRequest } from 'next/server';
import { apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple, requirePermission } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { ConversationService } from '@/server/services/conversation-service';
import { CustomerService } from '@/server/services/customer-service';
import { SettingsService } from '@/server/services/settings-service';
import { AlertRepository } from '@/server/repositories/alert-repository';

const conversationService = new ConversationService();
const customerService = new CustomerService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'conversations', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const hasRatingParam = searchParams.get('has_rating');
  const source = searchParams.get('source');
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  // Parse has_rating: 'true' -> true, 'false' -> false, null -> no filter
  let has_rating: boolean | null = null;
  if (hasRatingParam === 'true') has_rating = true;
  else if (hasRatingParam === 'false') has_rating = false;

  const offset = (page - 1) * limit;
  const result = await conversationService.listConversations({
    status,
    search,
    limit,
    offset,
    has_rating,
    source,
    start_date,
    end_date,
  });
  return apiSuccess({
    conversations: result.conversations,
    total: result.total,
    page,
    limit,
    statusCounts: result.statusCounts,
  });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'conversations', 'write');
  if (denied) return denied;
  const { data: body, error: parseError } = await parseJsonBody<{
    title?: string;
    source?: string;
    priority?: string;
    visitor_id?: string; // Web 端访客标识（localStorage UUID），用于识别回头客
    platform_connection_id?: string;
  }>(request);
  if (parseError) return parseError;

  const conversation = await conversationService.createConversation(body ?? {});

  // Insert welcome message if configured in settings
  try {
    const settingsService = new SettingsService();
    const settings = await settingsService.getSettingsMap();
    const welcomeMessage = settings.welcome_message;
    if (welcomeMessage && welcomeMessage.trim()) {
      await conversationService.insertMessage({
        conversation_id: conversation.id,
        role: 'assistant',
        content: welcomeMessage.trim(),
      });
    }

    // Create alert for new conversation notification if enabled
    if (settings.new_conversation_notify === 'true') {
      try {
        const alertRepo = new AlertRepository();
        await alertRepo.create({
          conversation_id: conversation.id,
          type: 'new_conversation',
          severity: 'info',
          message: `新对话已创建: ${conversation.title || '无标题'}`,
        });
      } catch (alertErr) {
        logger.api.error('Failed to create new conversation alert', { error: alertErr, conversationId: conversation.id });
      }
    }
  } catch (err) {
    // Welcome message is non-critical; log and continue
    logger.api.error('Failed to insert welcome message', { error: err, conversationId: conversation.id });
  }

  // 自动关联客户（失败不影响对话创建响应）
  try {
    await customerService.findOrCreateFromConversation({
      conversationId: conversation.id,
      source: body?.source || 'web',
      externalUserId: body?.visitor_id || null, // Web: visitor_id → 客户 external_id
      platformConnectionId: body?.platform_connection_id || null,
    });
  } catch (custErr) {
    logger.api.error('Failed to link customer', { error: custErr, conversationId: conversation.id });
  }

  return apiSuccess({ conversation }, HttpStatus.CREATED);
});
