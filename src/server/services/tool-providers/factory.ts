/**
 * Tool Provider Factory
 * Centralized factory for creating and accessing tool providers
 * Supports mock/real API switching via environment variable
 */

import { BaseToolProvider, ToolProviderType } from './types';
import { OrderProvider, getOrderProvider } from './order-provider';
import { LogisticsProvider, getLogisticsProvider } from './logistics-provider';
import { RefundProvider, getRefundProvider } from './refund-provider';
import { ProductProvider, getProductProvider } from './product-provider';
import { SizeChartProvider, getSizeChartProvider } from './size-chart-provider';

/**
 * Environment configuration for tool providers
 */
export interface ToolProviderConfig {
  /** Enable real API calls (default: false for mock mode) */
  enableRealApi: boolean;
  /** Custom order API URL */
  orderApiUrl?: string;
  /** Custom logistics API URL */
  logisticsApiUrl?: string;
  /** Custom refund API URL */
  refundApiUrl?: string;
}

/**
 * Get current provider configuration from environment
 */
export function getProviderConfig(): ToolProviderConfig {
  return {
    enableRealApi: process.env.ENABLE_REAL_TOOL_API === 'true',
    orderApiUrl: process.env.ORDER_API_URL,
    logisticsApiUrl: process.env.LOGISTICS_API_URL,
    refundApiUrl: process.env.REFUND_API_URL,
  };
}

/**
 * Tool Provider Factory
 * Use this factory to get provider instances instead of instantiating directly
 */
export class ToolProviderFactory {
  private static instances: Partial<Record<ToolProviderType, BaseToolProvider>> = {};

  /**
   * Get provider by type
   */
  static getProvider(type: ToolProviderType): BaseToolProvider {
    if (this.instances[type]) {
      return this.instances[type]!;
    }

    let provider: BaseToolProvider;

    switch (type) {
      case 'order':
        provider = getOrderProvider();
        break;
      case 'logistics':
        provider = getLogisticsProvider();
        break;
      case 'refund':
        provider = getRefundProvider();
        break;
      case 'product':
        provider = getProductProvider();
        break;
      case 'size_chart':
        provider = getSizeChartProvider();
        break;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }

    this.instances[type] = provider;
    return provider;
  }

  /**
   * Get all available provider types
   */
  static getAvailableTypes(): ToolProviderType[] {
    return ['order', 'logistics', 'refund', 'product', 'size_chart'];
  }

  /**
   * Clear all cached instances (useful for testing)
   */
  static clearCache(): void {
    this.instances = {};
  }

  /**
   * Get provider info for debugging
   */
  static getProviderInfo(type: ToolProviderType): {
    type: ToolProviderType;
    isRealApi: boolean;
    configured: boolean;
  } {
    const provider = this.getProvider(type);
    const config = getProviderConfig();

    const apiKeyMap: Record<ToolProviderType, string | undefined> = {
      order: config.orderApiUrl,
      logistics: config.logisticsApiUrl,
      refund: config.refundApiUrl,
      product: undefined, // Product provider uses internal DB
      size_chart: undefined, // Size chart provider uses internal DB
    };

    return {
      type,
      isRealApi: config.enableRealApi,
      configured: !!apiKeyMap[type],
    };
  }
}

/**
 * Convenience function to execute a tool by name
 * Maps tool names to provider types
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ message: string; confidence: number; isMockData: boolean; data?: Record<string, unknown> }> {
  const toolToProviderMap: Record<string, ToolProviderType> = {
    query_order_status: 'order',
    query_logistics: 'logistics',
    apply_refund: 'refund',
    query_product_detail: 'product',
    query_size_chart: 'size_chart',
  };

  const providerType = toolToProviderMap[toolName];
  if (!providerType) {
    return {
      message: `未知工具: ${toolName}`,
      confidence: 0.3,
      isMockData: false,
    };
  }

  const provider = ToolProviderFactory.getProvider(providerType);
  const result = await provider.execute(args);

  return {
    message: result.message,
    confidence: result.confidence,
    isMockData: result.isMockData,
    data: result.data,
  };
}
