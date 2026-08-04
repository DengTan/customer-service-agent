import { NextRequest } from 'next/server';
import { ExportService } from '@/server/services/export-service';
import { GET } from '@/lib/api/with-api';

const exportService = new ExportService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'analytics', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';

  return await exportService.exportAnalytics(format);
}, );

export { GETHandler as GET };
