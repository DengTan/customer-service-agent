import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, requireRole, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import {
  FASTGPT_OBJECT_ID_REGEX,
  isBlockedHostname,
  probeFastGPT,
} from '@/server/services/external-kb-probe';

const ADMIN_ONLY = ['admin'];

interface TestConnectionRequest {
  provider: string;
  baseUrl: string;
  apiKey: string;
  datasetId: string;
}

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return apiError('请求体格式错误', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const { provider, baseUrl, apiKey, datasetId } = body as TestConnectionRequest;

  if (!provider || !baseUrl || !apiKey || !datasetId) {
    return apiError('缺少必要参数', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return apiError('API 地址必须以 http:// 或 https:// 开头', {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
    });
  }

  // SSRF: block internal addresses
  try {
    const url = new URL(baseUrl);
    if (isBlockedHostname(url.hostname)) {
      return apiSuccess({
        success: false,
        message: 'API 地址不能指向内网地址',
      });
    }
  } catch {
    // invalid URL already caught by the startsWith check above
  }

  if (provider === 'fastgpt' && !FASTGPT_OBJECT_ID_REGEX.test(datasetId)) {
    return apiSuccess({
      success: false,
      message: `知识库 ID 格式不正确：FastGPT datasetId 必须是 24 位十六进制字符串（MongoDB ObjectId），当前值「${datasetId}」不符合要求。请到 FastGPT 控制台 → 知识库详情页查看正确的 ID。`,
    });
  }

  let result: { success: boolean; message: string; datasetFound?: boolean };

  switch (provider) {
    case 'fastgpt':
      result = await probeFastGPT(baseUrl, apiKey, datasetId);
      break;
    default:
      return apiError(`不支持的知识库提供商: ${provider}`, {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
      });
  }

  return apiSuccess(result);
});