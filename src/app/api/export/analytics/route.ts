import { NextRequest } from 'next/server';
import { ExportService } from '@/server/services/export-service';
import { withErrorHandlerSimple } from '@/lib/api-utils';

const exportService = new ExportService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';

  return await exportService.exportAnalytics(format);
});
