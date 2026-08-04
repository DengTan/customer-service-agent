import { ExportService } from '@/server/services/export-service';
import { GET } from '@/lib/api/with-api';
import { requireRole } from '@/lib/api-utils';

const exportService = new ExportService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'team', action: 'read' },
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  },
  async ({ request }) => {
    // Additional role check: only admin can export conversations
    const forbidden = requireRole(request, ['admin']);
    if (forbidden) return forbidden;

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
  },
);

export { GETHandler as GET };