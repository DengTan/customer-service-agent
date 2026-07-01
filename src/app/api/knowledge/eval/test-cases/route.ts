import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-utils';
import { getRetrievalEvalService } from '@/server/services/retrieval-eval-service';
import { logger } from '@/lib/logger';

// GET /api/knowledge/eval/test-cases - List test cases
// POST /api/knowledge/eval/test-cases - Create test case
// DELETE /api/knowledge/eval/test-cases?id=xxx - Delete test case
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') || undefined;
    const difficulty = searchParams.get('difficulty') || undefined;
    const testSet = searchParams.get('test_set') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;

    const evalService = getRetrievalEvalService();
    const testCases = await evalService.getTestCases({ category, difficulty, testSet, limit });

    return NextResponse.json({ test_cases: testCases, total: testCases.length });
  } catch (error) {
    logger.api.error('Failed to get test cases', { error });
    return NextResponse.json({ error: 'Failed to get test cases' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Only admin can create test cases
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { question, expected_answer, category, difficulty, test_set, metadata } = body;

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }

    const evalService = getRetrievalEvalService();
    const testCase = await evalService.createTestCase({
      question,
      expectedAnswer: expected_answer,
      category: category || '未分类',
      difficulty: difficulty || 'medium',
      testSet: test_set || 'default',
      metadata: metadata || {},
    });

    if (!testCase) {
      return NextResponse.json({ error: 'Failed to create test case' }, { status: 500 });
    }

    return NextResponse.json({ test_case: testCase }, { status: 201 });
  } catch (error) {
    logger.api.error('Failed to create test case', { error });
    return NextResponse.json({ error: 'Failed to create test case' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Only admin can delete test cases
    const authError = await requireRole(request, ['admin']);
    if (authError) return authError;

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const evalService = getRetrievalEvalService();
    const deleted = await evalService.deleteTestCase(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete test case' }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    logger.api.error('Failed to delete test case', { error });
    return NextResponse.json({ error: 'Failed to delete test case' }, { status: 500 });
  }
}
