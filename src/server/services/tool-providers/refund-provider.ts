/**
 * Refund Provider
 * Handles refund application operations with mock/real API switching
 * Note: Real refund operations require merchant credentials and should be carefully secured
 */

import { BaseToolProvider, ToolResult, ToolParams, ValidationResult, RefundResult } from './types';
import { generateMockOrder } from './mock-data';

export class RefundProvider extends BaseToolProvider {
  readonly type = 'refund' as const;

  /**
   * Validate refund application parameters
   */
  validate(params: ToolParams): ValidationResult {
    const orderId = params.order_id as string | undefined;
    const reason = params.reason as string | undefined;

    if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0) {
      return {
        valid: false,
        errorMessage: '请提供有效的订单编号',
        errorCode: 'MISSING_ORDER_ID',
      };
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return {
        valid: false,
        errorMessage: '请提供退款原因',
        errorCode: 'MISSING_REASON',
      };
    }

    if (reason.length > 500) {
      return {
        valid: false,
        errorMessage: '退款原因过长（最多500字）',
        errorCode: 'REASON_TOO_LONG',
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
   * Execute refund application
   * Falls back to confirmation button (mock) if real API is not available
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
    const reason = (params.reason as string).trim();
    const amount = (params.amount as number | undefined) || 0;

    try {
      // Try real API first if enabled
      if (this.isRealApi) {
        const result = await this.submitRealRefund(orderId, reason, amount);
        if (result) {
          return {
            message: result.message,
            data: { refund: result },
            confidence: this.adjustConfidence(this.getBaseConfidence(), true),
            isMockData: false,
          };
        }
        console.log(`[RefundProvider] Real API returned no data for ${orderId}, falling back to mock`);
      }

      // Use mock confirmation (default behavior)
      return this.getMockConfirmation(orderId, reason, amount);
    } catch (error) {
      console.error(`[RefundProvider] Error submitting refund for ${orderId}:`, error);
      return this.getMockConfirmation(orderId, reason, amount, true);
    }
  }

  /**
   * Submit real refund API
   * Returns null if order not found or API unavailable
   */
  private async submitRealRefund(orderId: string, reason: string, amount: number): Promise<RefundResult | null> {
    const apiUrl = process.env.REFUND_API_URL;
    const apiKey = process.env.REFUND_API_KEY;

    if (!apiUrl || !apiKey) {
      console.log('[RefundProvider] Real API not configured, using mock confirmation');
      return null;
    }

    const response = await fetch(`${apiUrl}/refunds`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-API-Version': '2024-01',
      },
      body: JSON.stringify({
        order_id: orderId,
        reason,
        amount,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Order not found
      }
      if (response.status === 400) {
        // Order not eligible for refund (already refunded, etc.)
        const errorData = await response.json().catch(() => ({}));
        return {
          refund_id: '',
          order_id: orderId,
          amount: 0,
          status: 'rejected',
          reason,
          estimated_days: 0,
          message: errorData.message || '该订单不支持退款',
        };
      }
      throw new Error(`Refund API returned ${response.status}`);
    }

    const data = await response.json();
    return data as RefundResult;
  }

  /**
   * Get mock refund confirmation with action buttons
   * Note: Lower confidence since this is a mock operation
   */
  private getMockConfirmation(orderId: string, reason: string, amount: number, isFallback = false): ToolResult {
    // Get order info for accurate amount
    const order = generateMockOrder(orderId);
    const refundAmount = amount > 0 ? amount : order.amount;
    const refundId = `RF${Date.now().toString().slice(-8)}`;

    return {
      message: `已为订单 ${orderId} 提交退款申请。退款原因：${reason}。预计1-3个工作日内处理，退款将原路返回您的支付账户。`,
      data: {
        message_type: 'action_buttons',
        rich_content: {
          title: '退款申请确认',
          description: `订单 ${orderId} 退款金额: ¥${refundAmount.toFixed(2)}，原因: ${reason}`,
          buttons: [
            { label: '确认退款', action: 'confirm_refund', data: { order_id: orderId, amount: refundAmount, refund_id: refundId } },
            { label: '取消', action: 'cancel_refund' },
          ],
        },
      },
      confidence: this.adjustConfidence(this.getBaseConfidence(), true) - (isFallback ? 0.15 : 0.1),
      isMockData: true,
    };
  }
}

// Singleton instance
let refundProviderInstance: RefundProvider | null = null;

export function getRefundProvider(): RefundProvider {
  if (!refundProviderInstance) {
    refundProviderInstance = new RefundProvider();
  }
  return refundProviderInstance;
}
