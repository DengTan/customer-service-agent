import { NextRequest, NextResponse } from "next/server";
import { gorgiasService } from "@/server/services/gorgias-service";
import { gorgiasSyncService, tryAcquireWebhookEvent } from "@/server/services/gorgias-sync-service";
import type { GorgiasWebhookEvent } from "@/lib/gorgias-client";
import { getLogger } from "@/lib/logger";

const logger = getLogger('GorgiasWebhook');

// 允许的事件类型白名单
const ALLOWED_EVENT_TYPES = [
  'ticket-created',
  'ticket-message-created',
  'ticket-updated',
  'ticket-self-unsnoozed',
  'ticket-message-failed',
  'ticket-handed-over',
] as const;

type AllowedEventType = typeof ALLOWED_EVENT_TYPES[number];

export async function POST(request: NextRequest) {
  try {
    // 1. 验证 shared secret（安全默认：必须配置且匹配）
    const secret = request.nextUrl.searchParams.get("secret");
    const configuredSecret = await gorgiasService.getWebhookSecret();

    // 如果配置了 secret，必须匹配；否则拒绝请求（安全默认）
    if (!configuredSecret) {
      logger.warn('Webhook received but no secret configured');
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 401 }
      );
    }

    if (secret !== configuredSecret) {
      return NextResponse.json(
        { error: "Invalid secret" },
        { status: 401 }
      );
    }

    // 2. 解析请求体（Gorgias 默认发送空 body，支持从 query params 获取参数）
    const bodyText = await request.text();
    logger.info('Webhook raw body received', {
      contentLength: bodyText.length,
      bodyPreview: bodyText.substring(0, 500),
    });

    // 从 query params 获取参数（Gorgias HTTP integration 支持 URL 模板变量 {{ticket.id}}）
    const searchParams = request.nextUrl.searchParams;
    const ticketIdFromQuery = searchParams.get('ticket_id');
    const eventTypeFromQuery = searchParams.get('event_type');

    let event: GorgiasWebhookEvent;

    if (!bodyText || bodyText.trim().length === 0) {
      // Body 为空：从 query params 构建事件（Gorgias 默认不发送 body payload）
      if (!ticketIdFromQuery) {
        logger.warn('Webhook received with empty body and no ticket_id in query params');
        return NextResponse.json(
          { error: "Empty request body and no ticket_id in query params. Please add &ticket_id={{ticket.id}} to your Gorgias webhook URL." },
          { status: 400 }
        );
      }

      const ticketId = parseInt(ticketIdFromQuery, 10);
      if (isNaN(ticketId)) {
        return NextResponse.json(
          { error: "Invalid ticket_id in query params" },
          { status: 400 }
        );
      }

      // 构建最小化事件对象，sync service 会从 API 拉取完整数据
      event = {
        id: Date.now(), // 生成一个伪事件 ID（因为没有 body，无法获取原始 event ID）
        type: (eventTypeFromQuery || 'ticket-message-created') as GorgiasWebhookEvent['type'],
        object_type: 'Ticket',
        object_id: ticketId,
        created_datetime: new Date().toISOString(),
        data: {} as GorgiasWebhookEvent['data'], // 空 data，sync service 会从 API 拉取
      };

      logger.info('Webhook event constructed from query params', {
        ticketId,
        eventType: event.type,
      });
    } else {
      // Body 不为空：正常解析 JSON
      try {
        event = JSON.parse(bodyText);
      } catch (parseError) {
        logger.error('Failed to parse webhook body as JSON', {
          bodyPreview: bodyText.substring(0, 200),
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
        });
        return NextResponse.json(
          { error: "Invalid JSON body", detail: "Body is not valid JSON" },
          { status: 400 }
        );
      }
    }

    // 3. 验证事件结构 - 输入校验（P1-6）
    if (!event.type || typeof event.type !== 'string') {
      return NextResponse.json(
        { error: "Invalid or missing event type" },
        { status: 400 }
      );
    }

    // 校验事件类型白名单
    if (!ALLOWED_EVENT_TYPES.includes(event.type as AllowedEventType)) {
      return NextResponse.json(
        { error: `Unsupported event type: ${event.type}` },
        { status: 400 }
      );
    }

    if (!event.object_type || event.object_type !== 'Ticket') {
      return NextResponse.json(
        { error: "Invalid or missing object_type" },
        { status: 400 }
      );
    }

    if (typeof event.object_id !== 'number') {
      return NextResponse.json(
        { error: "Invalid or missing object_id" },
        { status: 400 }
      );
    }

    // 4. 原子幂等处理：先尝试插入幂等记录，成功才处理（避免并发竞态）
    // 优先使用真实 Gorgias event.id 作为幂等键；
    // body 为空时 event.id 是 Date.now() 伪值，改用 ticket_id + event_type 组合键
    // 确保同一工单的同一事件类型不会重复处理
    const hasRealEventId = event.id && typeof event.id === 'number' && event.id < 1000000000000;
    let idempotencyKey: string;
    if (hasRealEventId) {
      idempotencyKey = String(event.id);
    } else {
      // 空 body 场景：用 ticket_id + event_type 组合作为幂等键
      // 不同事件类型（ticket-created / ticket-message-created / ticket-updated）各自独立幂等
      // 但同一工单同一类型的重复请求会被拦截
      idempotencyKey = `ticket_${event.object_id}_${event.type}`;
    }

    const acquired = await tryAcquireWebhookEvent(idempotencyKey, event.type, String(event.object_id));
    if (!acquired) {
      logger.info('Webhook event already processed (idempotent)', { idempotencyKey });
      return NextResponse.json({ received: true, duplicate: true });
    }

    // 5. 处理事件
    const result = await gorgiasSyncService.processWebhookEvent(event);

    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // 即使处理失败，也返回 200，避免 Gorgias 重试风暴
    logger.error('Webhook processing error', {
      error: error instanceof Error ? error.message : 'Unknown'
    });
    return NextResponse.json({
      received: true,
      error: "Internal server error"
    });
  }
}
