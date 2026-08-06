import { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/api-utils';
import { CustomerTagService } from '@/server/services/customer-tag-service';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';
import { parsePageParams, buildPageResult } from '@/lib/api/pagination';

const customerTagService = new CustomerTagService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'customers', action: 'read' },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePageParams(searchParams);
    const search = searchParams.get('search') ?? undefined;
    const category = searchParams.get('category') ?? undefined;

    const result = await customerTagService.listTagsPaginated({
      search: search ?? null,
      category: category ?? null,
      page,
      limit,
    });
    return apiSuccess(buildPageResult({ items: result.tags, total: result.total, page, limit }));
  },
);

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'customers', action: 'write' },
  },
  async ({ request }) => {
  const body = await request.json();
  const name = (body?.name as string) || '';
  const color = (body?.color as string) || '#2F6BFF';
  const category = (body?.category as string) || 'manual';

  const tag = await customerTagService.createTag({ name, color, category });
  return apiSuccess({ tag }, 201);
}, );

export { POSTHandler as POST };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'customers', action: 'write' },
  },
  async ({ request }) => {
  const body = await request.json();
  const id = (body?.id as string) || '';
  const updates: { id: string; name?: string; color?: string; category?: string } = { id };
  if (body?.name !== undefined) updates.name = body.name;
  if (body?.color !== undefined) updates.color = body.color;
  if (body?.category !== undefined) updates.category = body.category;

  const tag = await customerTagService.updateTag(updates);
  return apiSuccess({ tag });
}, );

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'customers', action: 'delete' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  await customerTagService.deleteTag(id);
  return apiSuccess({ success: true });
}, );

export { DELETEHandler as DELETE };
