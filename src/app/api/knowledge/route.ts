import { NextRequest } from 'next/server';
import { KnowledgeSearchService } from '@/server/services/knowledge-search-service';
import { apiError, apiSuccess, HttpStatus, withErrorHandlerSimple } from '@/lib/api-utils';

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const knowledgeSearchService = new KnowledgeSearchService();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const topK = parseInt(searchParams.get('topK') || '5', 10);
  const minScore = parseFloat(searchParams.get('minScore') || '0');

  if (!query) {
    return apiError('请提供搜索关键词', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await knowledgeSearchService.search(query, minScore, topK);

  return apiSuccess({
    results: result.sources.map((s) => ({
      content: s.content,
      score: s.score,
      id: s.id,
      title: s.title,
      type: s.type,
      category: s.category,
      image_url: s.image_url,
    })),
    context: result.context,
    confidence: result.confidence,
    images: result.images,
  });
});
