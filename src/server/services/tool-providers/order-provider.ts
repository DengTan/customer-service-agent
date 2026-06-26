/**
 * Order Provider
 * Handles order query operations with mock/real API switching
 */

import { BaseToolProvider, ToolResult, ToolParams, ValidationResult, OrderInfo } from './types';
import { generateMockOrder, getMockOrderStatusText } from './mock-data';

export class OrderProvider extends BaseToolProvider {
  readonly type = 'order' as const;

  /**
   * Validate order query parameters
   */
  validate(params: ToolParams): ValidationResult {
    const orderId = params.order_id as string | undefined;

    if (!orderId || typeof orderId !== 'string') {
      return {
        valid: false,
        errorMessage: '请提供有效的订单编号',
        errorCode: 'MISSING_ORDER_ID',
      };
    }

    if (orderId.trim().length === 0) {
      return {
        valid: false,
        errorMessage: '订单编号不能为空',
        errorCode: 'EMPTY_ORDER_ID',
      };
    }

    if (orderId.length > 50) {
      return {
        valid: false,
        errorMessage: '订单编号过长',
        errorCode: 'ORDER_ID_TOO_LONG',
      };
    }

    return { valid: true };
  }

  /**
   * Execute order query
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

    const orderId = (params.order_id as string).trim();

    try {
      // Try real API first if enabled
      if (this.isRealApi) {
        const result = await this.queryRealOrder(orderId);
        if (result) {
          return {
            message: this.formatOrderMessage(result),
            data: { order: result },
            confidence: this.adjustConfidence(this.getBaseConfidence(), true),
            isMockData: false,
          };
        }
        // Real API returned null, fall through to mock
        console.log(`[OrderProvider] Real API returned no data for ${orderId}, falling back to mock`);
      }

      // Use mock data
      return this.getMockResult(orderId);
    } catch (error) {
      // On any error, fall back to mock with degraded confidence
      console.error(`[OrderProvider] Error querying order ${orderId}:`, error);
      return this.getMockResult(orderId, true);
    }
  }

  /**
   * Query real order API
   * Returns null if order not found or API unavailable
   */
  private async queryRealOrder(orderId: string): Promise<OrderInfo | null> {
    const apiUrl = process.env.ORDER_API_URL;
    const apiKey = process.env.ORDER_API_KEY;

    if (!apiUrl || !apiKey) {
      console.log('[OrderProvider] Real API not configured, using mock data');
      return null;
    }

    const response = await fetch(`${apiUrl}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-API-Version': '2024-01',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Order not found, not an error
      }
      throw new Error(`Order API returned ${response.status}`);
    }

    const data = await response.json();
    return data as OrderInfo;
  }

  /**
   * Get mock result with appropriate confidence
   */
  private getMockResult(orderId: string, isFallback = false): ToolResult {
    const order = generateMockOrder(orderId);
    const confidence = this.adjustConfidence(
      this.getBaseConfidence(),
      true
    ) - (isFallback ? 0.1 : 0);

    return {
      message: this.formatOrderMessage(order),
      data: { order },
      confidence: Math.max(confidence, 0.3),
      isMockData: true,
    };
  }

  /**
   * Format order info into human-readable message
   */
  private formatOrderMessage(order: OrderInfo): string {
    const statusText = order.status.startsWith('paid') || order.status.startsWith('pending')
      ? getMockOrderStatusText(order.status)
      : getMockOrderStatusText(order.status);

    const date = new Date(order.created_at).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    let message = `订单 ${order.order_id} 当前状态：${statusText}。下单时间：${date}`;

    if (order.payment_method) {
      message += `。支付方式：${order.payment_method}`;
    }

    if (order.items.length > 0) {
      const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);
      message += `。商品：${order.items[0].name}${totalItems > 1 ? ` 等${totalItems}件` : ''}`;
    }

    return message;
  }
}

// Singleton instance
let orderProviderInstance: OrderProvider | null = null;

export function getOrderProvider(): OrderProvider {
  if (!orderProviderInstance) {
    orderProviderInstance = new OrderProvider();
  }
  return orderProviderInstance;
}
