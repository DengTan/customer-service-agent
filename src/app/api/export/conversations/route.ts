import { NextRequest } from 'next/server';
import { ExportService } from '@/server/services/export-service';
import { withErrorHandlerSimple } from '@/lib/api-utils';

const exportService = new ExportService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'csv';
  const status = searchParams.get('status') ?? undefined;
  const start_date = searchParams.get('start_date') ?? undefined;
  const end_date = searchParams.get('end_date') ?? undefined;
  const search = searchParams.get('search') ?? undefined;

  return await exportService.exportConversations(
    { status, start_date, end_date, search },
    format,
  );
});
