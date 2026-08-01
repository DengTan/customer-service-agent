import { NextRequest } from 'next/server';
import { apiError, HttpStatus, requirePermission } from '@/lib/api-utils';
import { getCategories, createCategory, updateCategory, deleteCategory } from '@/server/repositories/ticket-custom-field-repository';
import { getLogger } from '@/lib/logger';

const logger = getLogger('TicketsCategories');

export async function GET(request: Request) {
  try {
    const req = request as NextRequest;
    const denied = await requirePermission(req, 'tickets', 'read');
    if (denied) return denied;
    
    const categories = await getCategories();
    return Response.json({ categories });
  } catch (error) {
    logger.error('[Ticket Categories] GET error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('获取分类列表失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requirePermission(req, 'tickets', 'write');
    if (denied) return denied;
    
    const body = await req.json();
    const { name, color, description, sort_order } = body;
    if (!name) {
      return apiError('分类名称必填', { status: HttpStatus.BAD_REQUEST });
    }
    const category = await createCategory({
      name,
      color: color || '#6b7280',
      description: description || null,
      sort_order: sort_order || 0,
      is_active: true,
    });
    return Response.json({ category });
  } catch (error) {
    logger.error('[Ticket Categories] POST error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('创建分类失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = await requirePermission(req, 'tickets', 'write');
    if (denied) return denied;
    
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) {
      return apiError('分类ID必填', { status: HttpStatus.BAD_REQUEST });
    }
    const category = await updateCategory(id, updates);
    return Response.json({ category });
  } catch (error) {
    logger.error('[Ticket Categories] PUT error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('更新分类失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = await requirePermission(req, 'tickets', 'delete');
    if (denied) return denied;
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return apiError('分类ID必填', { status: HttpStatus.BAD_REQUEST });
    }
    await deleteCategory(id);
    return Response.json({ success: true });
  } catch (error) {
    logger.error('[Ticket Categories] DELETE error', { error: error instanceof Error ? error.message : String(error) });
    return apiError('删除分类失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
}
