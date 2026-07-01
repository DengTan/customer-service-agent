import { NextRequest } from 'next/server';
import { apiSuccess, apiError, HttpStatus, withErrorHandlerSimple, getAuthenticatedUserId, parseJsonBody } from '@/lib/api-utils';
import { simulationTestCaseRepository, type CreateTestCaseInput, type SimulationTestCase } from '@/server/repositories/simulation-test-case-repository';
import { logger } from '@/lib/logger';

const simTestCaseLogger = logger.api;

interface ImportedTestCase {
  name?: string;
  description?: string;
  category?: string;
  scripts?: string[];
  expected_outcomes?: string;
  tags?: string[];
}

interface ImportPayload {
  test_cases: ImportedTestCase[];
  default_category?: string;
}

// GET /api/simulation-test-cases/import - Export test cases as JSON
export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  const { searchParams } = new URL(request.url);
  const ids = searchParams.get('ids');

  let testCases: SimulationTestCase[] = [];

  if (ids) {
    const idList = ids.split(',').filter(Boolean);
    for (const id of idList) {
      const tc = await simulationTestCaseRepository.getById(id);
      if (tc) testCases.push(tc);
    }
  } else {
    const result = await simulationTestCaseRepository.list(userId ?? undefined, { limit: 1000 });
    testCases = result.items;
  }

  const exportData = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    test_cases: testCases.map(tc => ({
      name: tc.name,
      description: tc.description,
      category: tc.category,
      scripts: tc.scripts,
      expected_outcomes: tc.expected_outcomes,
      tags: tc.tags,
    })),
  };

  return apiSuccess({ data: exportData });
});

// POST /api/simulation-test-cases/import - Import test cases from JSON
export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return apiError('未登录', { status: HttpStatus.UNAUTHORIZED });
  }

  const { data: body, error: parseError } = await parseJsonBody<ImportPayload>(request);
  if (parseError) return parseError;

  if (!body?.test_cases || !Array.isArray(body.test_cases) || body.test_cases.length === 0) {
    return apiError('导入数据格式错误：缺少 test_cases 数组', { status: HttpStatus.BAD_REQUEST });
  }

  const defaultCategory = body.default_category || '导入用例';
  const validCases: CreateTestCaseInput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < body.test_cases.length; i++) {
    const tc = body.test_cases[i];
    const index = i + 1;

    if (!tc.name?.trim()) {
      errors.push(`第 ${index} 条：缺少名称`);
      continue;
    }
    if (!tc.category?.trim()) {
      errors.push(`第 ${index} 条（${tc.name}）：缺少分类`);
      continue;
    }
    if (!Array.isArray(tc.scripts) || tc.scripts.length === 0) {
      errors.push(`第 ${index} 条（${tc.name}）：缺少测试脚本`);
      continue;
    }

    validCases.push({
      name: tc.name.trim(),
      description: tc.description?.trim() || null,
      category: tc.category.trim(),
      status: 'draft',
      scripts: tc.scripts.filter((s): s is string => typeof s === 'string' && s.trim().length > 0),
      expected_outcomes: tc.expected_outcomes?.trim() || null,
      tags: Array.isArray(tc.tags) ? tc.tags.filter((t): t is string => typeof t === 'string') : [],
      source_conversation_id: null,
      created_by: userId,
    });
  }

  if (validCases.length === 0) {
    return apiError('没有有效的测试用例可导入', { status: HttpStatus.BAD_REQUEST, meta: { errors } });
  }

  try {
    const created = await simulationTestCaseRepository.createMany(validCases);

    simTestCaseLogger.info('[SimulationTestCase] Test cases imported', {
      userId,
      total: body.test_cases.length,
      imported: created.length,
      errors: errors.length,
    });

    return apiSuccess({
      imported: created.length,
      total: body.test_cases.length,
      errors: errors.length > 0 ? errors : undefined,
      testCases: created,
    }, HttpStatus.CREATED);
  } catch (err) {
    simTestCaseLogger.error('[SimulationTestCase] Import failed', { error: err });
    return apiError('导入失败', { status: HttpStatus.INTERNAL_SERVER_ERROR });
  }
});
