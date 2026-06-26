import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { CustomerTagService } from '@/server/services/customer-tag-service';

const customerTagService = new CustomerTagService();

export const GET = withErrorHandlerSimple(async () => {
  const tags = await customerTagService.listTags();
  return apiSuccess({ tags });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const name = (body?.name as string) || '';
  const color = (body?.color as string) || '#2F6BFF';
  const category = (body?.category as string) || 'manual';

  const tag = await customerTagService.createTag({ name, color, category });
  return apiSuccess({ tag }, 201);
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const id = (body?.id as string) || '';
  const updates: { id: string; name?: string; color?: string; category?: string } = { id };
  if (body?.name !== undefined) updates.name = body.name;
  if (body?.color !== undefined) updates.color = body.color;
  if (body?.category !== undefined) updates.category = body.category;

  const tag = await customerTagService.updateTag(updates);
  return apiSuccess({ tag });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  await customerTagService.deleteTag(id);
  return apiSuccess({ success: true });
});
