import { NextRequest } from 'next/server';
import { apiSuccess, apiError, HttpStatus, withErrorHandlerSimple, getAuthenticatedUserId, parseJsonBody } from '@/lib/api-utils';
import { simulationTestCaseRepository, type TestCaseStatus } from '@/server/repositories/simulation-test-case-repository';
import { logger } from '@/lib/logger';

const simTestCaseLogger = logger.api;

// GET /api/simulation-test-cases - List test cases with filters
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = (page - 1) * limit;
  const category = searchParams.get('category') || undefined;
  const status = searchParams.get('status') as TestCaseStatus | undefined;
  const search = searchParams.get('search') || undefined;

  const result = await simulationTestCaseRepository.list(userId ?? undefined, {
    category,
    status,
    search,
    limit,
    offset,
  });

  return apiSuccess({
    testCases: result.items,
    total: result.total,
    page,
    limit,
  });
});

// POST /api/simulation-test-cases - Create a new test case
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    name: string;
    description?: string;
    category: string;
    status?: TestCaseStatus;
    scripts: string[];
    expected_outcomes?: string;
    tags?: string[];
    source_conversation_id?: string;
  }>(request);

  if (parseError) return parseError;

  if (!body?.name?.trim()) {
    return apiError('测试用例名称不能为空', { status: HttpStatus.BAD_REQUEST });
  }
  if (!body?.category?.trim()) {
    return apiError('分类不能为空', { status: HttpStatus.BAD_REQUEST });
  }
  if (!Array.isArray(body?.scripts) || body.scripts.length === 0) {
    return apiError('测试脚本不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  const testCase = await simulationTestCaseRepository.create({
    name: body.name.trim(),
    description: body.description?.trim() || null,
    category: body.category.trim(),
    status: body.status || 'draft',
    scripts: body.scripts.filter((s): s is string => typeof s === 'string' && s.trim().length > 0),
    expected_outcomes: body.expected_outcomes?.trim() || null,
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [],
    source_conversation_id: body.source_conversation_id || null,
    created_by: userId,
  });

  simTestCaseLogger.info('[SimulationTestCase] Test case created', {
    testCaseId: testCase.id,
    userId,
    category: testCase.category,
  });

  return apiSuccess({ testCase }, HttpStatus.CREATED);
});

// PUT /api/simulation-test-cases - Update an existing test case
export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { data: body, error: parseError } = await parseJsonBody<{
    id: string;
    name?: string;
    description?: string;
    category?: string;
    status?: TestCaseStatus;
    scripts?: string[];
    expected_outcomes?: string;
    tags?: string[];
  }>(request);

  if (parseError) return parseError;

  if (!body?.id) {
    return apiError('测试用例ID不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  // Verify the test case exists
  const existing = await simulationTestCaseRepository.getById(body.id);
  if (!existing) {
    return apiError('测试用例不存在', { status: HttpStatus.NOT_FOUND });
  }

  // Validate if updating scripts
  if (body.scripts !== undefined) {
    if (!Array.isArray(body.scripts) || body.scripts.length === 0) {
      return apiError('测试脚本不能为空', { status: HttpStatus.BAD_REQUEST });
    }
  }

  const updated = await simulationTestCaseRepository.update({
    id: body.id,
    name: body.name?.trim(),
    description: body.description !== undefined ? (body.description?.trim() || null) : undefined,
    category: body.category?.trim(),
    status: body.status,
    scripts: body.scripts?.filter((s): s is string => typeof s === 'string' && s.trim().length > 0),
    expected_outcomes: body.expected_outcomes !== undefined ? (body.expected_outcomes?.trim() || null) : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : undefined,
  });

  if (!updated) {
    return apiError('更新失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  simTestCaseLogger.info('[SimulationTestCase] Test case updated', {
    testCaseId: body.id,
    userId,
  });

  return apiSuccess({ testCase: updated });
});

// DELETE /api/simulation-test-cases - Delete a test case
export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('测试用例ID不能为空', { status: HttpStatus.BAD_REQUEST });
  }

  // Verify the test case exists
  const existing = await simulationTestCaseRepository.getById(id);
  if (!existing) {
    return apiError('测试用例不存在', { status: HttpStatus.NOT_FOUND });
  }

  const deleted = await simulationTestCaseRepository.delete(id);
  if (!deleted) {
    return apiError('删除失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }

  simTestCaseLogger.info('[SimulationTestCase] Test case deleted', {
    testCaseId: id,
    userId,
  });

  return apiSuccess({ success: true });
});
