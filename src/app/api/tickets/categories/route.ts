import { NextRequest, NextResponse } from 'next/server';
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/server/repositories/ticket-custom-field-repository';
import { getLogger } from '@/lib/logger';

const logger = getLogger('TicketsCategories');

export async function GET() {
  try {
    const categories = await getCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    logger.error('[Ticket Categories] GET error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '获取分类列表失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, color, description, sort_order } = body;
    if (!name) {
      return NextResponse.json({ error: '分类名称必填' }, { status: 400 });
    }
    const category = await createCategory({
      name,
      color: color || '#6b7280',
      description: description || null,
      sort_order: sort_order || 0,
      is_active: true,
    });
    return NextResponse.json({ category });
  } catch (error) {
    logger.error('[Ticket Categories] POST error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '创建分类失败' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: '分类ID必填' }, { status: 400 });
    }
    const category = await updateCategory(id, updates);
    return NextResponse.json({ category });
  } catch (error) {
    logger.error('[Ticket Categories] PUT error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '更新分类失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: '分类ID必填' }, { status: 400 });
    }
    await deleteCategory(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Ticket Categories] DELETE error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: '删除分类失败' }, { status: 500 });
  }
}
