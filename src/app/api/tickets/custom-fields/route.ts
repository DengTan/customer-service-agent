import { NextRequest, NextResponse } from 'next/server';
import { getCustomFields, createCustomField, updateCustomField, deleteCustomField } from '@/server/repositories/ticket-custom-field-repository';
import { getLogger } from '@/lib/logger';

const logger = getLogger('TicketsCustomFields');

export async function GET() {
  try {
    const fields = await getCustomFields();
    return NextResponse.json({ fields });
  } catch (error) {
    logger.error('[Ticket Custom Fields] GET error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '获取自定义字段失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, field_key, field_type, options, is_required, sort_order } = body;
    if (!name || !field_key) {
      return NextResponse.json({ error: '字段名称和字段标识必填' }, { status: 400 });
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
    return NextResponse.json({ field });
  } catch (error: unknown) {
    logger.error('[Ticket Custom Fields] POST error', { error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message?.includes('duplicate')) {
      return NextResponse.json({ error: '字段标识已存在' }, { status: 409 });
    }
    return NextResponse.json({ error: '创建自定义字段失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: '字段ID必填' }, { status: 400 });
    }
    const field = await updateCustomField(id, updates);
    return NextResponse.json({ field });
  } catch (error) {
    logger.error('[Ticket Custom Fields] PUT error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '更新自定义字段失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '字段ID必填' }, { status: 400 });
    }
    await deleteCustomField(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Ticket Custom Fields] DELETE error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '删除自定义字段失败' }, { status: 500 });
  }
}
