import { NextRequest } from 'next/server';
import { withErrorHandler, apiSuccess, requirePermission } from '@/lib/api-utils';
import { GET } from '@/lib/api/with-api';
import { CustomerService } from '@/server/services/customer-service';

const customerService = new CustomerService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'customers', action: 'read' },
  },
  async ({ request, params }) => {
  const { id } = params as { id: string };
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const result = await customerService.getCustomer(id, limit, offset);
  return apiSuccess({ customer: result.customer, conversations: result.conversations });
}, );

export { GETHandler as GET };
