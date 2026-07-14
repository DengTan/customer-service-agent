import { NextRequest } from 'next/server';
import { QualityService } from '@/server/services/quality-service';
import { apiSuccess, withErrorHandlerSimple, requirePermission } from '@/lib/api-utils';

const service = new QualityService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'quality', 'read');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('end_date') || undefined;

  const stats = await service.getStats({ startDate, endDate });
  return apiSuccess(stats);
});
