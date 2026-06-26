/**
 * Tool Provider Types
 * Abstract interfaces for tool providers with mock/real API switching support
 */

// ─── Base Types ────────────────────────────────────────────

export interface ToolResult {
  /** Human-readable result message */
  message: string;
  /** Structured data (optional, for rich content) */
  data?: Record<string, unknown>;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether result comes from mock data */
  isMockData: boolean;
  /** Error code if failed */
  errorCode?: string;
}

export interface ToolParams {
  /** Tool-specific parameters */
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errorMessage?: string;
  errorCode?: string;
}

// ─── Order Types ────────────────────────────────────────────

export interface OrderInfo {
  order_id: string;
  product_name: string;
  amount: number;
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  created_at: string;
  payment_method?: string;
  shipping_address?: string;
  items: {
    name: string;
    quantity: number;
    price: number;
  }[];
}

export interface OrderQueryParams extends ToolParams {
  order_id: string;
}

// ─── Logistics Types ────────────────────────────────────────

export interface LogisticsStep {
  time: string;
  desc: string;
  active: boolean;
  location?: string;
}

export interface LogisticsInfo {
  order_id: string;
  carrier: string;
  tracking_no: string;
  status: 'pending' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'returned';
  estimated_delivery?: string;
  steps: LogisticsStep[];
}

export interface LogisticsQueryParams extends ToolParams {
  order_id?: string;
  tracking_number?: string;
}

// ─── Refund Types ────────────────────────────────────────────

export interface RefundApplyParams extends ToolParams {
  order_id: string;
  reason: string;
  amount?: number;
}

export interface RefundResult {
  refund_id: string;
  order_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  reason: string;
  estimated_days: number;
  message: string;
}

// ─── Provider Interface ──────────────────────────────────────

export type ToolProviderType = 'order' | 'logistics' | 'refund' | 'product' | 'size_chart';

/**
 * Abstract base class for all tool providers.
 * Implement this interface to create a new provider for any tool.
 */
export abstract class BaseToolProvider {
  /** Provider type identifier */
  abstract readonly type: ToolProviderType;
  
  /** Whether this provider uses real API (vs mock) */
  protected isRealApi: boolean;

  constructor() {
    this.isRealApi = process.env.ENABLE_REAL_TOOL_API === 'true';
  }

  /**
   * Validate input parameters before execution.
   * @throws Error with message if validation fails
   */
  abstract validate(params: ToolParams): ValidationResult;

  /**
   * Execute the tool with given parameters.
   * @throws Error if execution fails
   */
  abstract execute(params: ToolParams): Promise<ToolResult>;

  /**
   * Get the base confidence score for this provider.
   * Real API calls get higher confidence, mock gets lower.
   */
  protected getBaseConfidence(): number {
    return this.isRealApi ? 0.85 : 0.6;
  }

  /**
   * Adjust confidence based on data quality.
   */
  protected adjustConfidence(base: number, hasData: boolean): number {
    if (!hasData) return 0.3;
    if (this.isRealApi) return Math.min(base + 0.1, 0.95);
    return base;
  }
}
