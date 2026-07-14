/**
 * Logistics Provider
 * Handles logistics query operations with mock/real API switching
 */

import { BaseToolProvider, ToolResult, ToolParams, ValidationResult, LogisticsInfo } from './types';
import { generateMockLogistics, getMockLogisticsStatusText } from './mock-data';
import { logger } from '@/lib/logger';

export class LogisticsProvider extends BaseToolProvider {
  readonly type = 'logistics' as const;

  /**
   * Validate logistics query parameters
   * Accepts either order_id or tracking_number
   */
  validate(params: ToolParams): ValidationResult {
    const orderId = params.order_id as string | undefined;
    const trackingNumber = params.tracking_number as string | undefined;
    const identifier = orderId || trackingNumber;

    if (!identifier || typeof identifier !== 'string') {
      return {
        valid: false,
        errorMessage: '请提供订单号或物流单号',
        errorCode: 'MISSING_TRACKING_INFO',
      };
    }

    if (identifier.trim().length === 0) {
      return {
        valid: false,
        errorMessage: '订单号或物流单号不能为空',
        errorCode: 'EMPTY_TRACKING_INFO',
      };
    }

    if (identifier.length > 50) {
      return {
        valid: false,
        errorMessage: '订单号或物流单号过长',
        errorCode: 'TRACKING_INFO_TOO_LONG',
      };
    }

    return { valid: true };
  }

  /**
   * Execute logistics query
   * Falls back to mock data if real API is not available
   */
  async execute(params: ToolParams): Promise<ToolResult> {
    const validation = this.validate(params);
    if (!validation.valid) {
      return {
        message: validation.errorMessage!,
        confidence: 0.3,
        isMockData: false,
        errorCode: validation.errorCode,
      };
    }

    // Use order_id as primary identifier, fall back to tracking_number
    const identifier = ((params.order_id || params.tracking_number) as string).trim();

    try {
      // Try real API first if enabled
      if (this.isRealApi) {
        const result = await this.queryRealLogistics(identifier);
        if (result) {
          return {
            message: this.formatLogisticsMessage(result),
            data: { logistics: result },
            confidence: this.adjustConfidence(this.getBaseConfidence(), true),
            isMockData: false,
          };
        }
        logger.debug(`[LogisticsProvider] Real API returned no data for ${identifier}, falling back to mock`);
      }

      // Use mock data
      return this.getMockResult(identifier);
    } catch (error) {
      logger.error(`[LogisticsProvider] Error querying logistics ${identifier}:`, { error });
      return this.getMockResult(identifier, true);
    }
  }

  /**
   * Query real logistics API
   * Returns null if logistics not found or API unavailable
   */
  private async queryRealLogistics(identifier: string): Promise<LogisticsInfo | null> {
    const apiUrl = process.env.LOGISTICS_API_URL;
    const apiKey = process.env.LOGISTICS_API_KEY;

    if (!apiUrl || !apiKey) {
      logger.debug('[LogisticsProvider] Real API not configured, using mock data');
      return null;
    }

    const response = await fetch(`${apiUrl}/logistics/${encodeURIComponent(identifier)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-API-Version': '2024-01',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Logistics API returned ${response.status}`);
    }

    const data = await response.json();
    return data as LogisticsInfo;
  }

  /**
   * Get mock result with appropriate confidence
   */
  private getMockResult(identifier: string, isFallback = false): ToolResult {
    const logistics = generateMockLogistics(identifier);
    const confidence = this.adjustConfidence(
      this.getBaseConfidence(),
      true
    ) - (isFallback ? 0.1 : 0);

    return {
      message: this.formatLogisticsMessage(logistics),
      data: { logistics },
      confidence: Math.max(confidence, 0.3),
      isMockData: true,
    };
  }

  /**
   * Format logistics info into human-readable message
   */
  private formatLogisticsMessage(logistics: LogisticsInfo): string {
    const statusText = getMockLogisticsStatusText(logistics.status);
    const steps = logistics.steps;
    const latestStep = steps.find(s => s.active) || steps[steps.length - 1];

    let message = `物流单号 ${logistics.tracking_no}，快递公司：${logistics.carrier}。`;
    message += `当前状态：${statusText}。`;

    if (latestStep) {
      message += `最新动态：${latestStep.desc}。`;
      if (latestStep.time) {
        const time = new Date(latestStep.time).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        message += `(${time})`;
      }
    }

    if (logistics.estimated_delivery && logistics.status !== 'delivered') {
      message += `预计${logistics.estimated_delivery}送达。`;
    }

    return message;
  }
}

// Singleton instance
let logisticsProviderInstance: LogisticsProvider | null = null;

export function getLogisticsProvider(): LogisticsProvider {
  if (!logisticsProviderInstance) {
    logisticsProviderInstance = new LogisticsProvider();
  }
  return logisticsProviderInstance;
}
