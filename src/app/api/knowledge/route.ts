import { NextRequest } from 'next/server';
import { KnowledgeClient, Config } from 'coze-coding-dev-sdk';
import { apiError, apiSuccess, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const config = new Config();
  const client = new KnowledgeClient(config);
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const topK = parseInt(searchParams.get('topK') || '5', 10);
  const minScore = parseFloat(searchParams.get('minScore') || '0.75');

  if (!query) {
    return apiError('请提供搜索关键词', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await client.search(query, undefined, topK, minScore);

  if (result.code !== 0) {
    return apiError('知识库搜索失败', { status: HttpStatus.INTERNAL_SERVER_ERROR, internalMessage: result.msg, code: 'KNOWLEDGE_SEARCH_ERROR' });
  }

  return apiSuccess({ results: result.chunks });
});
