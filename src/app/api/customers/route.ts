import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, apiSuccess } from '@/lib/api-utils';
import { CustomerService } from '@/server/services/customer-service';

const customerService = new CustomerService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const includeAnonymous = searchParams.get('include_anonymous') === 'true';
  const filters = {
    search: searchParams.get('search') ?? undefined,
    platform: searchParams.get('platform') ?? undefined,
    tag: searchParams.get('tag') ?? undefined,
    page: parseInt(searchParams.get('page') || '1'),
    pageSize: parseInt(searchParams.get('pageSize') || '20'),
    includeAnonymous,
  };
  const result = await customerService.listCustomers(filters);
  return apiSuccess({ customers: result.customers, total: result.total, page: result.page, pageSize: result.pageSize });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { name, phone, email, source_platform, tags, notes, metadata } = body ?? {};

  const customer = await customerService.createCustomer({
    name,
    phone: phone || null,
    email: email || null,
    source_platform: source_platform || 'web',
    tags: tags || [],
    notes: notes || null,
    metadata: metadata || null,
  });
  return apiSuccess({ customer }, 201);
});

export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const body = await request.json();
  const { id, name, phone, email, tags, notes, metadata, is_anonymous } = body ?? {};

  const customer = await customerService.updateCustomer({
    id,
    name,
    phone,
    email,
    tags,
    notes,
    metadata,
    // 坐席补充信息后（如填写了姓名/手机/邮箱）将匿名标记改为 false
    is_anonymous: is_anonymous ?? undefined,
  });
  return apiSuccess({ customer });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  await customerService.deleteCustomer(id);
  return apiSuccess({ success: true });
});
