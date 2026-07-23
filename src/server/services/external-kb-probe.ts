/**
 * Shared helpers for FastGPT connection probing.
 *
 * Two routes call into this module:
 *  1. POST /api/knowledge/external/test-connection       — caller supplies apiKey (UI form)
 *  2. POST /api/knowledge/external/test-connection/saved — server reads apiKey from settings
 *
 * Both routes share the same SSRF check, ObjectId regex, and FastGPT list probe logic.
 */
import { logger } from '@/lib/logger';

export const FASTGPT_OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export interface FastGPTProbeRequest {
  provider: string;
  baseUrl: string;
  apiKey: string;
  datasetId: string;
}

export interface FastGPTProbeResult {
  success: boolean;
  message: string;
  datasetFound?: boolean;
}

interface FastGPTDataset {
  id: string;
  name?: string;
}

interface FastGPTListResponse {
  code?: number;
  data?: FastGPTDataset[];
  message?: string;
  statusText?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

/** Blocked hostnames and IP ranges for SSRF protection. */
const SSRF_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
]);

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTNAMES.has(h)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;
  if (h === '::1' || h === 'fe80::1') return true;
  return false;
}

/**
 * Verify that the datasetId is reachable on the FastGPT instance.
 *
 * Two-step probe:
 *   1) Hit the dataset LIST endpoint to validate baseUrl + API Key,
 *      independent of the supplied datasetId. This avoids the failure mode
 *      where an INVALID datasetId (HTTP 400) masks a wrong API Key (HTTP 401).
 *   2) Confirm the supplied datasetId exists in the returned list.
 *
 * The list endpoint only needs `parentId`. Any ObjectId-format datasetId can
 * be looked up by `id` match in the returned array.
 */
export async function probeFastGPT(
  baseUrl: string,
  apiKey: string,
  datasetId: string,
): Promise<FastGPTProbeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    const listUrl = `${normalizeBaseUrl(baseUrl)}/core/dataset/list`;
    logger.info('测试 FastGPT 连接（list 端点）', { url: listUrl });

    response = await fetch(listUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ parentId: '' }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        message: '连接超时（15秒），请检查：1) API 地址是否正确 2) FastGPT 服务是否运行 3) 网络是否可达',
      };
    }
    logger.error('FastGPT 连接测试 fetch 失败', { error: err });
    return {
      success: false,
      message: `连接失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  clearTimeout(timeoutId);

  const responseBody = await response.text();
  logger.info('FastGPT list 响应', {
    status: response.status,
    body: responseBody.slice(0, 200),
  });

  if (response.ok) {
    let parsed: FastGPTListResponse;
    try {
      parsed = JSON.parse(responseBody) as FastGPTListResponse;
    } catch {
      return { success: false, message: `FastGPT 返回了非 JSON 响应: ${responseBody.slice(0, 100)}` };
    }

    logger.info('[test-connection] FastGPT list raw response', {
      code: parsed.code,
      data: parsed.data,
      dataStr: JSON.stringify(parsed.data ?? '').slice(0, 500),
    });

    if (parsed.code !== undefined && parsed.code !== 200 && parsed.code !== 0) {
      return {
        success: false,
        message: `FastGPT 业务错误 (code=${parsed.code}): ${parsed.message || parsed.statusText || '未知'}`,
      };
    }

    // FastGPT is backed by MongoDB; ObjectId serialises as { "$oid": "..." }.
    // Also handle plain string and the unlikely plain-object id field.
    const extractString = (val: unknown): string | undefined => {
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        if (typeof obj.$oid === 'string') return obj.$oid;
        if (typeof obj.id === 'string') return obj.id;
        if (typeof obj._id === 'string') return obj._id;
        if (typeof obj.datasetId === 'string') return obj.datasetId;
      }
      return undefined;
    };

    const normalizeId = (d: unknown): string => extractString(d) ?? '';
    const normalizeName = (d: unknown): string => {
      if (typeof d === 'object' && d !== null) {
        return String((d as Record<string, unknown>).name ?? '');
      }
      return '';
    };

    const rawItems = Array.isArray(parsed.data) ? parsed.data : [];
    if (rawItems.length === 0) {
      return {
        success: false,
        message: `连接成功，但该 API Key 未找到任何知识库。可能原因：1) API Key 无知识库访问权限 2) 知识库在子文件夹中，root 账号不可见。请到 FastGPT 控制台确认该 Key 的权限范围。`,
        datasetFound: false,
      };
    }
    const datasets = rawItems.map((d) => ({ id: normalizeId(d), name: normalizeName(d) })).filter((d) => d.id);

    if (datasets.length === 0) {
      return {
        success: false,
        message: `连接成功，但该 API Key 可访问的知识库返回了 ${rawItems.length} 条记录但无法解析出 ID（响应结构异常：${JSON.stringify(rawItems).slice(0, 300)}）。请联系开发者排查。`,
        datasetFound: false,
      };
    }
    const match = datasets.find((d) => d.id === datasetId);
    if (!match) {
      const availableIds = datasets.map((d) => `${d.id}${d.name ? `(${d.name})` : ''}`).slice(0, 10);
      const suffix = datasets.length > 10 ? ` 等共 ${datasets.length} 个` : '';
      return {
        success: false,
        message: `连接成功但未找到匹配的知识库 ID「${datasetId}」。该 API Key 可访问的知识库共 ${datasets.length} 个${suffix}：${availableIds.join('、')}。请确认知识库 ID 是否正确，或检查该 Key 是否有对应知识库的访问权限。`,
        datasetFound: false,
      };
    }

    return {
      success: true,
      message: `连接成功，知识库「${match.name ?? datasetId}」可访问`,
      datasetFound: true,
    };
  }

  // Classify failure by status code — FastGPT does NOT short-circuit auth
  // checks before zod validation, so we have to read the response body to
  // tell "wrong API key" from "wrong datasetId" / "wrong baseUrl".
  let fastGPTMessage: string | undefined;
  try {
    const parsed = JSON.parse(responseBody) as FastGPTListResponse;
    fastGPTMessage = parsed.message || parsed.statusText;
  } catch {
    // not JSON; ignore
  }

  if (response.status === 401) {
    return { success: false, message: '认证失败：API Key 无效或已过期' };
  }
  if (response.status === 403) {
    return { success: false, message: '权限不足：请检查 API Key 是否有知识库访问权限' };
  }
  if (response.status === 404) {
    return {
      success: false,
      message: `未找到 FastGPT API 端点。请检查 API 地址，官方云版应为 https://cloud.fastgpt.cn/api`,
    };
  }
  if (response.status === 400) {
    return {
      success: false,
      message: `请求被 FastGPT 拒绝 (400): ${fastGPTMessage ?? '参数校验失败'}。当前 API Key 可访问 FastGPT，但参数异常。`,
    };
  }

  // FastGPT Cloud returns 500 + structured body for auth failures (unAuthApiKey=514)
  // and version errors (unAuthUser=502). Treat both as auth-related feedback.
  if (response.status === 500 && fastGPTMessage) {
    if (/514|unAuthApiKey|unAuthUser/i.test(fastGPTMessage)) {
      return {
        success: false,
        message: '认证失败：API Key 无效或已过期。请到 FastGPT 控制台核对 API Key。',
      };
    }
    return {
      success: false,
      message: `FastGPT 业务错误: ${fastGPTMessage}（HTTP 500）`,
    };
  }

  return {
    success: false,
    message: `FastGPT 返回 HTTP ${response.status}: ${fastGPTMessage ?? responseBody.slice(0, 100)}`,
  };
}