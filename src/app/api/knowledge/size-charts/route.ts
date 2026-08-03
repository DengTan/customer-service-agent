import { apiSuccess, apiError, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';
import { SizeChartService } from '@/server/services/size-chart-service';
import { isServiceError } from '@/server/services/service-error';

const sizeChartService = new SizeChartService();

// ─── GET /api/knowledge/size-charts ──────────────────────────────────────────

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);

    const filters: Record<string, string | undefined> = {
      category: searchParams.get('category') || undefined,
      parent_category: searchParams.get('parent_category') || undefined,
      status: searchParams.get('status') || undefined,
      search: searchParams.get('search') || undefined,
      chart_type: searchParams.get('chart_type') || undefined,
      product_id: searchParams.get('product_id') || undefined,
      platform_connection_id: searchParams.get('platform_connection_id') || undefined,
    };

    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('page_size') || '50', 10);

    const result = await sizeChartService.listSizeCharts(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
      { page, pageSize },
    );

    return apiSuccess(result);
  },
);

export { GETHandler as GET };

// ─── POST /api/knowledge/size-charts ─────────────────────────────────────────

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      name?: string;
      category?: string;
      parent_category?: string | null;
      chart_type?: string;
      size_columns?: Array<{ key: string; label: string }>;
      size_rows?: Array<Record<string, string>>;
      product_ids?: string[];
      product_id?: string | null;
      sku?: string | null;
      recommend_params?: { dimensions: unknown[] } | null;
      recommend_rules?: string | null;
      description?: string | null;
      image_url?: string | null;
      platform_connection_id?: string | null;
    }>(request);
    if (parseError) return parseError;
    if (!body) {
      return apiError('请求体无效', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    try {
      const sizeChart = await sizeChartService.createSizeChart({
        name: body.name ?? '',
        category: body.category ?? '',
        parent_category: body.parent_category ?? null,
        chart_type: body.chart_type ?? 'custom',
        size_columns: body.size_columns || [],
        size_rows: body.size_rows || [],
        product_id: Array.isArray(body.product_ids) ? body.product_ids[0] ?? null : (body.product_id ?? null),
        sku: body.sku ?? null,
        recommend_params: body.recommend_params as { dimensions: Array<{ key: string; label: string; unit?: string; range?: [number, number]; required?: boolean }> } | null,
        recommend_rules: body.recommend_rules ?? null,
        description: body.description ?? null,
        image_url: body.image_url ?? null,
        platform_connection_id: body.platform_connection_id ?? null,
      });

      return apiSuccess({ sizeChart }, HttpStatus.CREATED);
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
        return apiError(error.userMessage, { status, code: error.code });
      }
      throw error;
    }
  },
);

export { POSTHandler as POST };

// ─── PUT /api/knowledge/size-charts ─────────────────────────────────────────

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'write' },
  },
  async ({ request }) => {
    const { data: body, error: parseError } = await parseJsonBody<{
      id?: string;
      name?: string;
      category?: string;
      parent_category?: string | null;
      chart_type?: string;
      size_columns?: Array<{ key: string; label: string }>;
      size_rows?: Array<Record<string, string>>;
      product_ids?: string[];
      product_id?: string | null;
      sku?: string;
      recommend_params?: { dimensions: unknown[] } | null;
      recommend_rules?: string;
      description?: string;
      image_url?: string;
      status?: string;
      platform_connection_id?: string | null;
    }>(request);
    if (parseError) return parseError;
    if (!body || !body.id) {
      return apiError('请提供尺码表ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    try {
      await sizeChartService.updateSizeChart({
        id: body.id,
        name: body.name,
        category: body.category,
        parent_category: body.parent_category,
        chart_type: body.chart_type,
        size_columns: body.size_columns,
        size_rows: body.size_rows,
        product_id: Array.isArray(body.product_ids) ? body.product_ids[0] ?? null : (body.product_id ?? null),
        sku: body.sku,
        recommend_params: (body.recommend_params ?? null) as { dimensions: Array<{ key: string; label: string; unit?: string; range?: [number, number]; required?: boolean }> } | null,
        recommend_rules: body.recommend_rules,
        description: body.description,
        image_url: body.image_url,
        status: body.status,
        platform_connection_id: body.platform_connection_id,
      });

      return apiSuccess({ message: '尺码表已更新' });
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status === 409 ? 409 : error.status === 404 ? 404 : 400;
        return apiError(error.userMessage, { status, code: error.code });
      }
      throw error;
    }
  },
);

export { PUTHandler as PUT };

// ─── DELETE /api/knowledge/size-charts ───────────────────────────────────────

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'knowledge', action: 'delete' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('请提供尺码表ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
    }

    try {
      await sizeChartService.deleteSizeChart(id);
      return apiSuccess({ message: '尺码表已删除' });
    } catch (error) {
      if (isServiceError(error)) {
        const status = error.status === 404 ? 404 : 500;
        return apiError(error.userMessage, { status });
      }
      throw error;
    }
  },
);

export { DELETEHandler as DELETE };