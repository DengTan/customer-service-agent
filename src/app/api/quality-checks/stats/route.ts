import { NextRequest } from 'next/server';
import { QualityService } from '@/server/services/quality-service';
import { apiSuccess } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';

const service = new QualityService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'quality', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('end_date') || undefined;

  const stats = await service.getStats({ startDate, endDate });
  return apiSuccess(stats);
}, );

export { GETHandler as GET };
