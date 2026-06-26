import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess } from '@/lib/api-utils';
import { CustomerService } from '@/server/services/customer-service';

const customerService = new CustomerService();

export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const result = await customerService.getCustomer(id);
  return apiSuccess({ customer: result.customer, conversations: result.conversations });
});
