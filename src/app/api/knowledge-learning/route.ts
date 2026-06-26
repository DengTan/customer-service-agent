import { NextRequest } from 'next/server';
import { KnowledgeLearningService } from '@/server/services/knowledge-learning-service';
import { apiError, apiSuccess, parseJsonBody, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';

const service = new KnowledgeLearningService();

// GET /api/knowledge-learning - 获取候选QA列表，支持筛选和统计
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const filters: {
    status?: string;
    confidenceMin?: number;
    confidenceMax?: number;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page: number;
    pageSize: number;
  } = {
    page: parseInt(searchParams.get('page') || '1', 10),
    pageSize: parseInt(searchParams.get('pageSize') || '20', 10),
  };
  const status = searchParams.get('status');
  if (status) filters.status = status;
  const confidenceMin = searchParams.get('confidenceMin');
  if (confidenceMin) filters.confidenceMin = parseFloat(confidenceMin);
  const confidenceMax = searchParams.get('confidenceMax');
  if (confidenceMax) filters.confidenceMax = parseFloat(confidenceMax);
  const dateFrom = searchParams.get('dateFrom');
  if (dateFrom) filters.dateFrom = dateFrom;
  const dateTo = searchParams.get('dateTo');
  if (dateTo) filters.dateTo = dateTo;
  const search = searchParams.get('search');
  if (search) filters.search = search;

  const result = await service.listItems(filters);
  return apiSuccess(result);
});

// POST /api/knowledge-learning - 扫描对话提取候选QA
export const POST = withErrorHandlerSimple(async () => {
  const result = await service.scanConversations();
  return apiSuccess(result);
});

// PATCH /api/knowledge-learning - 审核操作（通过/拒绝/批量操作）
export const PATCH = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const patchBody = body! as { ids: string[]; action: string; question?: string; answer?: string; category?: string };
  const { ids, action, question, answer, category } = patchBody;

  if (!ids || ids.length === 0) {
    return apiError('请提供要操作的条目ID', {
      status: HttpStatus.BAD_REQUEST,
    });
  }

  if (action === 'approve') {
    const result = await service.approveItems(ids, {
      question: question as string | undefined,
      answer: answer as string | undefined,
      category: category as string | undefined,
    });
    return apiSuccess(result);
  }

  if (action === 'reject') {
    const result = await service.rejectItems(ids);
    return apiSuccess(result);
  }

  return apiError('无效的操作类型', {
    status: HttpStatus.BAD_REQUEST,
  });
});

// PUT /api/knowledge-learning - 编辑候选QA内容
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const updates: { question?: string | null; answer?: string | null; category?: string | null } = {};
  const patchBody = body! as { id: string; question?: string | null; answer?: string | null; category?: string | null };
  const { id } = patchBody;

  if (!id) {
    return apiError('请提供条目ID', {
      status: HttpStatus.BAD_REQUEST,
    });
  }

  if (patchBody.question !== undefined) updates.question = patchBody.question;
  if (patchBody.answer !== undefined) updates.answer = patchBody.answer;
  if (patchBody.category !== undefined) updates.category = patchBody.category;

  await service.updateItem(id, updates);
  return apiSuccess({});
});
