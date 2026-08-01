import { NextRequest } from 'next/server';
import { apiError, HttpStatus, requirePermission } from '@/lib/api-utils';
import { getCustomFields, createCustomField, updateCustomField, deleteCustomField } from '@/server/repositories/ticket-custom-field-repository';
import { getLogger } from '@/lib/logger';

const logger = getLogger('TicketsCustomFields');

export async function GET(request: Request) {
  try {
    const req = request as NextRequest;
    const denied = await requirePermission(req, 'tickets', 'read');
    if (denied) return denied;
    
    const fields = await getCustomFields();
    return Response.json({ fields });
  } catch (error) {
    logger.error('[Ticket Custom Fields] GET error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('获取自定义字段失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requirePermission(req, 'tickets', 'write');
    if (denied) return denied;
    
    const body = await req.json();
    const { name, field_key, field_type, options, is_required, sort_order } = body;
    if (!name || !field_key) {
      return apiError('字段名称和字段标识必填', { status: HttpStatus.BAD_REQUEST });
    }
    const field = await createCustomField({
      name,
      field_key,
      field_type: field_type || 'text',
      options: options || null,
      is_required: is_required || false,
      sort_order: sort_order || 0,
      is_active: true,
    });
    return Response.json({ field });
  } catch (error: unknown) {
    logger.error('[Ticket Custom Fields] POST error', { error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message?.includes('duplicate')) {
      return apiError('字段标识已存在', { status: HttpStatus.CONFLICT });
    }
    return apiError('创建自定义字段失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = await requirePermission(req, 'tickets', 'write');
    if (denied) return denied;
    
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return apiError('字段ID必填', { status: HttpStatus.BAD_REQUEST });
    }
    const field = await updateCustomField(id, updates);
    return Response.json({ field });
  } catch (error) {
    logger.error('[Ticket Custom Fields] PUT error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('更新自定义字段失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = await requirePermission(req, 'tickets', 'delete');
    if (denied) return denied;
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return apiError('字段ID必填', { status: HttpStatus.BAD_REQUEST });
    }
    await deleteCustomField(id);
    return Response.json({ success: true });
  } catch (error) {
    logger.error('[Ticket Custom Fields] DELETE error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('删除自定义字段失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}
