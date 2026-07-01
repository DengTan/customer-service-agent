import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandlerSimple, apiSuccess, requirePermission } from '@/lib/api-utils';
import { CustomerService } from '@/server/services/customer-service';

const customerService = new CustomerService();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'customers', 'read');
  if (denied) return denied;

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

  // 计算统计信息
  const stats = {
    total: result.total,
    byPlatform: { web: 0, qianniu: 0, doudian: 0 } as Record<string, number>,
  };
  const customers = result.customers as Array<{ source_platform: string }>;
  customers.forEach(c => {
    if (stats.byPlatform[c.source_platform] !== undefined) {
      stats.byPlatform[c.source_platform]++;
    }
  });

  return apiSuccess({
    customers: result.customers,
    stats,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize
  });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const denied = await requirePermission(request, 'customers', 'write');
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '请求体格式无效' },
      { status: 400 }
    );
  }
  const { name, phone, email, source_platform, tags, notes, metadata } = body ?? {};

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: '客户姓名不能为空' },
      { status: 400 }
    );
  }

  if (name.length > 200) {
    return NextResponse.json(
      { success: false, error: '客户姓名不能超过200个字符' },
      { status: 400 }
    );
  }

  // Validate email format if provided
  if (email && typeof email === 'string') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: '邮箱格式不正确' },
        { status: 400 }
      );
    }
  }

  // Validate phone format if provided
  if (phone && typeof phone === 'string' && phone.length > 0) {
    if (phone.length > 50) {
      return NextResponse.json(
        { success: false, error: '手机号不能超过50个字符' },
        { status: 400 }
      );
    }
  }

  const customer = await customerService.createCustomer({
    name: name.trim(),
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
  const denied = await requirePermission(request, 'customers', 'write');
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: '请求体格式无效' },
      { status: 400 }
    );
  }
  const { id, name, phone, email, tags, notes, metadata, is_anonymous } = body ?? {};

  // Validate required fields
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: '客户ID不能为空' },
      { status: 400 }
    );
  }

  // Validate name if provided
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: '客户姓名不能为空' },
        { status: 400 }
      );
    }
    if (name.length > 200) {
      return NextResponse.json(
        { success: false, error: '客户姓名不能超过200个字符' },
        { status: 400 }
      );
    }
  }

  // Validate email format if provided
  if (email !== undefined && email !== null && typeof email === 'string') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: '邮箱格式不正确' },
        { status: 400 }
      );
    }
  }

  // Validate phone if provided
  if (phone !== undefined && phone !== null && typeof phone === 'string' && phone.length > 0) {
    if (phone.length > 50) {
      return NextResponse.json(
        { success: false, error: '手机号不能超过50个字符' },
        { status: 400 }
      );
    }
  }

  const customer = await customerService.updateCustomer({
    id,
    name: name?.trim(),
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
  // Fine-grained permission check
  const denied = await requirePermission(request, 'customers', 'delete');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      { success: false, error: '缺少 ID 参数' },
      { status: 400 }
    );
  }

  // 检查是否有进行中的对话
  try {
    const result = await customerService.getCustomer(id);
    const activeConversations = (result.conversations as Array<{ status: string }>)
      .filter(c => c.status !== 'completed');

    if (activeConversations.length > 0) {
      return NextResponse.json(
        { success: false, error: '该客户有进行中的对话，无法删除' },
        { status: 400 }
      );
    }
  } catch {
    // 客户不存在，继续删除
  }

  await customerService.deleteCustomer(id);
  return apiSuccess({ success: true });
});
