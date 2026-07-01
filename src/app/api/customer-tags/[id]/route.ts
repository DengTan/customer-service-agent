import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, apiSuccess, apiError } from '@/lib/api-utils';
import { CustomerTagService } from '@/server/services/customer-tag-service';

const customerTagService = new CustomerTagService();

export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const tag = await customerTagService.getTagById(id);
  if (!tag) {
    return apiError('标签不存在', { status: 404 });
  }
  return apiSuccess({ tag });
});
