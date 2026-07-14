import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess, requirePermission } from '@/lib/api-utils';
import { CustomerService } from '@/server/services/customer-service';

const customerService = new CustomerService();

export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(request, 'customers', 'read');
  if (denied) return denied;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const result = await customerService.getCustomer(id, limit, offset);
  return apiSuccess({ customer: result.customer, conversations: result.conversations });
});
