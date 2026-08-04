/**
 * Knowledge eval test cases API
 */

import { withApi } from '@/lib/api/with-api';
import { getRetrievalEvalService } from '@/server/services/retrieval-eval-service';
import { logger } from '@/lib/logger';

export const GET = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const category = searchParams.get('category') || undefined;
      const difficulty = searchParams.get('difficulty') || undefined;
      const testSet = searchParams.get('test_set') || undefined;
      const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;

      const evalService = getRetrievalEvalService();
      const testCases = await evalService.getTestCases({ category, difficulty, testSet, limit });

      return new Response(JSON.stringify({ test_cases: testCases, total: testCases.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Failed to get test cases', { error });
      return new Response(JSON.stringify({ error: 'Failed to get test cases' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const POST = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    try {
      const body = await request.json();
      const { question, expected_answer, category, difficulty, test_set, metadata } = body;

      if (!question || typeof question !== 'string') {
        return new Response(JSON.stringify({ error: 'question is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
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
        return new Response(JSON.stringify({ error: 'Failed to create test case' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ test_case: testCase }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Failed to create test case', { error });
      return new Response(JSON.stringify({ error: 'Failed to create test case' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

export const DELETE = withApi(
  { auth: 'required', perm: { resource: 'knowledge', action: 'write' } },
  async ({ request }) => {
    try {
      const searchParams = request.nextUrl.searchParams;
      const id = searchParams.get('id');

      if (!id) {
        return new Response(JSON.stringify({ error: 'id is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const evalService = getRetrievalEvalService();
      const deleted = await evalService.deleteTestCase(id);

      if (!deleted) {
        return new Response(JSON.stringify({ error: 'Failed to delete test case' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      logger.api.error('Failed to delete test case', { error });
      return new Response(JSON.stringify({ error: 'Failed to delete test case' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);
