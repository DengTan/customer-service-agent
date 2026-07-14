import type { SWRConfiguration } from 'swr';

/**
 * SWR global configuration optimized for SmartAssist
 */
export const swrConfig: SWRConfiguration = {
  revalidateOnFocus: false,     // 失焦后不自动重新验证
  revalidateIfStale: true,       // 有过期数据时重新验证
  dedupingInterval: 5000,        // 5秒内相同请求去重
  errorRetryCount: 3,            // 错误重试3次
  shouldRetryOnError: (error) => {
    // 只在服务器错误时重试，4xx 不重试
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        return false;
      }
    }
    return true;
  },
};
