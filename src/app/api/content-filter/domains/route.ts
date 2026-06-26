import { NextRequest } from 'next/server';
import { apiSuccess, apiError, parseJsonBody, withErrorHandlerSimple, HttpStatus } from '@/lib/api-utils';
import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';
import { requireRole } from '@/lib/api-utils';

const repository = new ContentFilterRepository();

export const GET = withErrorHandlerSimple(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const isEnabledParam = searchParams.get('is_enabled');
  const is_enabled = isEnabledParam !== null ? isEnabledParam === 'true' : undefined;

  const domains = await repository.listAllowedDomains({ is_enabled });
  return apiSuccess({ domains });
});

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  await requireRole(request, ['admin']);
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const input = body as Record<string, unknown> | undefined;
  if (!input?.domain || typeof input.domain !== 'string' || !input.domain.trim()) {
    return apiError('域名不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const domain = await repository.createAllowedDomain({
    domain: (input.domain as string).trim(),
    pattern_type: (input.pattern_type as 'exact' | 'wildcard' | 'suffix') ?? 'exact',
    description: input.description as string | undefined,
    is_enabled: (input.is_enabled as boolean | undefined) ?? true,
    created_by: input.created_by as string | undefined,
  });

  return apiSuccess({ domain }, HttpStatus.CREATED);
});

export const PUT = withErrorHandlerSimple(async (request: NextRequest) => {
  await requireRole(request, ['admin']);
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const input = body as Record<string, unknown> | undefined;
  if (!input?.id) {
    return apiError('缺少域名 ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const domain = await repository.updateAllowedDomain(input.id as string, {
    domain: typeof input.domain === 'string' ? input.domain.trim() : undefined,
    pattern_type: input.pattern_type as 'exact' | 'wildcard' | 'suffix' | undefined,
    description: input.description as string | undefined,
    is_enabled: input.is_enabled as boolean | undefined,
  });

  return apiSuccess({ domain });
});

export const DELETE = withErrorHandlerSimple(async (request: NextRequest) => {
  await requireRole(request, ['admin']);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少域名 ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  await repository.deleteAllowedDomain(id);
  return apiSuccess({});
});
