import { NextRequest } from 'next/server';
import { z } from 'zod';
import { BotConfigService } from '@/server/services/bot-config-service';
import {
  apiSuccess,
  apiError,
  HttpStatus,
} from '@/lib/api-utils';
import { GET as defineGet } from '@/lib/api/with-api';

const service = new BotConfigService();
const UuidSchema = z.string().uuid({ message: '必须是合法 UUID' });

// GET /api/bot-configs/audit-log?bot_id=xxx[&limit=20][&offset=0]
export const GET = defineGet(
  { auth: 'required', perm: { resource: 'bots', action: 'read' } },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const botId = searchParams.get('bot_id');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const parsed = UuidSchema.safeParse(botId);
    if (!parsed.success) {
      return apiError('缺少或格式不正确的 bot_id 参数', {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const logs = await service.getAuditLog(parsed.data, { limit, offset });
      return apiSuccess(logs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查询审计日志失败';
      return apiError(msg, { status: 500, code: 'INTERNAL_ERROR' });
    }
  },
);
