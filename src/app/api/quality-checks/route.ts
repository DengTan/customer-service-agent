import { NextRequest } from 'next/server';
import { QualityService } from '@/server/services/quality-service';
import { apiError, apiSuccess, parseJsonBody, HttpStatus } from '@/lib/api-utils';
import { GET, POST, PUT, DELETE } from '@/lib/api/with-api';
import type { QualityRuleType } from '@/lib/types';

const QUALITY_RULE_TYPES: QualityRuleType[] = [
  'first_response_timeout',
  'keyword_violation',
  'satisfaction_below',
  'high_turn_count',
  'negative_sentiment',
];

const service = new QualityService();

export const GETHandler = GET(
  {
    auth: 'required',
    perm: { resource: 'quality', action: 'read' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  if (type === 'rules' || !type) {
    const isEnabled =
      searchParams.get('is_enabled') !== null
        ? searchParams.get('is_enabled') === 'true'
        : undefined;

    const result = await service.listRules(isEnabled);
    return apiSuccess(result);
  }

  if (type === 'records') {
    const result = await service.listCheckRecords(
      searchParams.get('result'),
      searchParams.get('rule_type'),
      searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    );
    return apiSuccess(result);
  }

  return apiError('无效的type参数', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
}, );

export { GETHandler as GET };

export const POSTHandler = POST(
  {
    auth: 'required',
    perm: { resource: 'quality', action: 'write' },
  },
  async ({ request }) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const { name, type, config, is_enabled } = (body ?? {}) as Record<string, unknown>;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return apiError('规则名称不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }
  if (name.trim().length > 100) {
    return apiError('规则名称不能超过100个字符', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }
  if (!type || !QUALITY_RULE_TYPES.includes(type as QualityRuleType)) {
    return apiError(`无效的规则类型，支持的类型: ${QUALITY_RULE_TYPES.join(', ')}`, { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await service.createRule({
    name: name.trim(),
    type: type as string,
    config: config as Record<string, unknown> | undefined,
    is_enabled: is_enabled as boolean | undefined,
  });
  return apiSuccess(result);
}, );

export { POSTHandler as POST };

export const PUTHandler = PUT(
  {
    auth: 'required',
    perm: { resource: 'quality', action: 'write' },
  },
  async ({ request }) => {
  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  const { id, name, type, config, is_enabled } = (body ?? {}) as Record<string, unknown>;

  if (!id) {
    return apiError('缺少规则ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return apiError('规则名称不能为空', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }
  if (name !== undefined && name.trim().length > 100) {
    return apiError('规则名称不能超过100个字符', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }
  if (type !== undefined && !QUALITY_RULE_TYPES.includes(type as QualityRuleType)) {
    return apiError(`无效的规则类型，支持的类型: ${QUALITY_RULE_TYPES.join(', ')}`, { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await service.updateRule(id as string, {
    name: name !== undefined ? (name as string).trim() : undefined,
    type: type as string | undefined,
    config: config as Record<string, unknown> | undefined,
    is_enabled: is_enabled as boolean | undefined,
  });
  return apiSuccess(result);
}, );

export { PUTHandler as PUT };

export const DELETEHandler = DELETE(
  {
    auth: 'required',
    perm: { resource: 'quality', action: 'delete' },
  },
  async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return apiError('缺少规则ID', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const result = await service.deleteRule(id);
  return apiSuccess(result);
}, );

export { DELETEHandler as DELETE };
