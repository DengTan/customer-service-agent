import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess, requirePermission } from '@/lib/api-utils';
import { CustomerService } from '@/server/services/customer-service';

const customerService = new CustomerService();

export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await requirePermission(_request, 'customers', 'read');
  if (denied) return denied;

  const { id } = await params;
  const result = await customerService.getCustomer(id);
  return apiSuccess({ customer: result.customer, conversations: result.conversations });
});
