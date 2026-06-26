import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, withErrorHandlerSimple, HttpStatus } from '@/lib/api-utils';
import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';
import { requireRole } from '@/lib/api-utils';

const repository = new ContentFilterRepository();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || undefined;
  const isEnabledParam = searchParams.get('is_enabled');
  const is_enabled = isEnabledParam !== null ? isEnabledParam === 'true' : undefined;

  const words = await repository.listSensitiveWords({ category, is_enabled });
  return apiSuccess({ words });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  await requireRole(request, ['admin']);
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const input = body as Record<string, unknown> | undefined;
  if (!input?.word || typeof input.word !== 'string' || !input.word.trim()) {
    return apiError('敏感词不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const word = await repository.createSensitiveWord({
    word: (input.word as string).trim(),
    match_mode: (input.match_mode as 'exact' | 'fuzzy') ?? 'exact',
    action: (input.action as 'block' | 'replace' | 'warn') ?? 'block',
    replacement: input.replacement as string | undefined,
    category: (input.category as string) ?? '脏话',
    is_enabled: (input.is_enabled as boolean | undefined) ?? true,
    created_by: input.created_by as string | undefined,
  });

  return apiSuccess({ word }, HttpStatus.CREATED);
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  await requireRole(request, ['admin']);
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const input = body as Record<string, unknown> | undefined;
  if (!input?.id) {
    return apiError('缺少敏感词 ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const word = await repository.updateSensitiveWord(input.id as string, {
    word: typeof input.word === 'string' ? input.word.trim() : undefined,
    match_mode: input.match_mode as 'exact' | 'fuzzy' | undefined,
    action: input.action as 'block' | 'replace' | 'warn' | undefined,
    replacement: input.replacement as string | undefined,
    category: input.category as string | undefined,
    is_enabled: input.is_enabled as boolean | undefined,
  });

  return apiSuccess({ word });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  await requireRole(request, ['admin']);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少敏感词 ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  await repository.deleteSensitiveWord(id);
  return apiSuccess({});
});
