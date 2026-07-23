/**
 * Test connection using the API Key already stored in settings.
 *
 * POST /api/knowledge/external/test-connection/saved
 *
 * Body: { provider, baseUrl, datasetId }
 *
 * The API Key is intentionally NOT accepted from the body — this endpoint
 * exists so the UI can re-test the connection on page reload without forcing
 * the user to re-type the key (the key is never returned in plaintext by
 * GET /api/knowledge/external/settings).
 *
 * baseUrl and datasetId are still taken from the body so that pending edits
 * in the UI form are tested against, rather than the stale values in settings
 * (which would only get overwritten after the debounced PUT fires).
 */
import { NextRequest } from 'next/server';
import { withErrorHandlerSimple, requireRole, apiSuccess, apiError, HttpStatus } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { getServiceRoleClient, isDemoMode } from '@/storage/database/supabase-client';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import {
  FASTGPT_OBJECT_ID_REGEX,
  isBlockedHostname,
  probeFastGPT,
} from '@/server/services/external-kb-probe';

const ADMIN_ONLY = ['admin'];
const EXTERNAL_KB_API_KEY = 'external_knowledge_api_key';

interface TestConnectionSavedRequest {
  provider: string;
  baseUrl: string;
  datasetId: string;
}

export const POST = withErrorHandlerSimple(async (request: NextRequest) => {
  const forbidden = await requireRole(request, ADMIN_ONLY);
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return apiError('请求体格式错误', { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR' });
  }

  const { provider, baseUrl, datasetId } = body as TestConnectionSavedRequest;

  if (!provider || !baseUrl || !datasetId) {
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

  // In demo mode there is no persisted key to test against.
  if (isDemoMode()) {
    return apiSuccess({
      success: false,
      message: 'Demo 模式下未保存任何 API Key，无法测试已保存的连接。',
    });
  }

  // Read the saved API Key from settings.
  const client = getServiceRoleClient();
  const repo = new SettingsRepository(client);
  const allSettings = await repo.list();
  const apiKey = allSettings.find((row) => row.key === EXTERNAL_KB_API_KEY)?.value ?? '';

  if (!apiKey) {
    return apiSuccess({
      success: false,
      message: '尚未保存 API Key，请先在设置中保存后再测试。',
    });
  }

  logger.info('[test-connection/saved] 使用已保存的 API Key 测试连接', {
    provider,
    baseUrl,
    datasetId,
    apiKeyLength: apiKey.length,
  });

  const result = await probeFastGPT(baseUrl, apiKey, datasetId);

  // Suffix the success message so the user knows the saved key was used.
  if (result.success) {
    return apiSuccess({
      ...result,
      message: `${result.message}（使用你已保存的 API Key）`,
    });
  }

  return apiSuccess(result);
});