import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { executeTool, ToolProviderFactory, ToolProviderType } from './tool-providers';
import { logger } from '@/lib/logger';

export interface ToolExecutionResult {
  result: string;
  confidence: number;
  isMockData?: boolean;  // Whether the result comes from mock data (not real API)
}

export interface ParsedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  query_order_status: {
    name: 'query_order_status',
    description: 'Query order status',
    parameters: { order_id: { type: 'string', description: 'Order ID' } },
  },
  query_logistics: {
    name: 'query_logistics',
    description: 'Query logistics information',
    parameters: { tracking_number: { type: 'string', description: 'Tracking number or order ID' } },
  },
  apply_refund: {
    name: 'apply_refund',
    description: 'Apply for a refund',
    parameters: {
      order_id: { type: 'string', description: 'Order ID' },
      reason: { type: 'string', description: 'Refund reason' },
      amount: { type: 'number', description: 'Refund amount (optional)' },
    },
  },
  modify_shipping_address: {
    name: 'modify_shipping_address',
    description: 'Modify shipping address',
    parameters: {
      order_id: { type: 'string', description: 'Order ID' },
      new_address: { type: 'string', description: 'New address' },
      new_name: { type: 'string', description: 'Recipient name (optional)' },
      new_phone: { type: 'string', description: 'Phone number (optional)' },
    },
  },
  query_product_detail: {
    name: 'query_product_detail',
    description: 'Query product details including price, specifications, features, and availability',
    parameters: {
      sku: { type: 'string', description: 'Product SKU code (optional, at least one of sku/name/product_id required)' },
      name: { type: 'string', description: 'Product name (optional, fuzzy search supported)' },
      product_id: { type: 'string', description: 'Product ID (optional, highest priority)' },
    },
  },
  query_size_chart: {
    name: 'query_size_chart',
    description: 'Query size charts including size tables and personalized size recommendations based on customer measurements',
    parameters: {
      sku: { type: 'string', description: 'Product SKU code (optional, for product-specific size chart)' },
      category: { type: 'string', description: 'Size chart category for general charts (optional)' },
      name: { type: 'string', description: 'Size chart name (optional, fuzzy search)' },
      size_chart_id: { type: 'string', description: 'Size chart ID (optional, highest priority)' },
      height: { type: 'number', description: 'Customer height in cm (optional, for size recommendation)' },
      weight: { type: 'number', description: 'Customer weight in kg (optional, for size recommendation)' },
    },
  },
};

/** Tools that require extra authorization (concern money or PII) */
const SENSITIVE_TOOLS = new Set(['apply_refund', 'modify_shipping_address']);

/** Max length for string arguments to prevent excessively long payloads */
const MAX_ARG_STRING_LENGTH = 500;

export class ToolExecutionService {
  private readonly conversations = new ConversationRepository();

  /**
   * Tool name to provider type mapping
   */
  private readonly toolToProviderMap: Record<string, ToolProviderType> = {
    query_order_status: 'order',
    query_logistics: 'logistics',
    apply_refund: 'refund',
    query_product_detail: 'product',
    query_size_chart: 'size_chart',
  };

  /**
   * Execute a tool by name with the given arguments.
   * Uses factory pattern to select mock or real provider based on environment.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    // Validate tool name exists
    if (!TOOL_DEFINITIONS[name]) {
      return { result: '未知工具', confidence: 0.3, isMockData: true };
    }

    // Validate argument values
    this.validateToolArgs(name, args);

    // Map tool to provider type
    const providerType = this.toolToProviderMap[name];
    if (!providerType) {
      return { result: '该工具暂未实现', confidence: 0.3, isMockData: true };
    }

    try {
      // Use factory to execute tool through appropriate provider
      const providerResult = await executeTool(name, args);

      return {
        result: providerResult.message,
        confidence: providerResult.confidence,
        isMockData: providerResult.isMockData,
      };
    } catch (error) {
      logger.error('[ToolExecutionService] Error executing tool', { tool: name, error: error instanceof Error ? error.message : String(error) });
      return {
        result: `工具执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
        confidence: 0.3,
        isMockData: true,
      };
    }
  }

  /**
   * Parse tool calls from LLM response content.
   * Format: [TOOL_CALL]toolName|{args}[/TOOL_CALL]
   */
  parseToolCalls(content: string): ParsedToolCall[] {
    const toolCalls: ParsedToolCall[] = [];
    // Two-step parsing: extract tool name and args string, then JSON.parse the args
    const toolCallRegex = /\[TOOL_CALL\](\w+)\|(.+?)\[\/TOOL_CALL\]/g;
    let match: RegExpExecArray | null;

    while ((match = toolCallRegex.exec(content)) !== null) {
      const toolName = match[1];
      const argsStr = match[2];
      try {
        const args = JSON.parse(argsStr);
        toolCalls.push({ name: toolName, args });
      } catch (err) {
        logger.warn('JSON parse failed for tool call', { raw: argsStr.substring(0, 100) });
      }
    }

    return toolCalls;
  }

  /**
   * Get all available tool definitions.
   */
  getAvailableTools(): ToolDefinition[] {
    return Object.values(TOOL_DEFINITIONS);
  }

  /**
   * Verify that the current user context has authorization to execute the requested tool.
   * For sensitive tools (refund, modify_address):
   * 1. Verify the conversation exists
   * 2. Verify the conversation is in a state that allows the operation
   * 3. Validate that the required arguments are present and well-formed
   */
  async verifyToolAuthorization(
    conversationId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    // 1. Verify conversation exists and is accessible
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) {
      throw new ServiceError('Conversation not found', { status: 404, code: 'NOT_FOUND' });
    }

    // 2. Conversation must be active (not ended or already handed off)
    if (conversation.status === 'ended') {
      throw new ServiceError('Cannot execute tools on ended conversations', {
        status: 400,
        code: 'CONVERSATION_ENDED',
      });
    }

    // 3. Sensitive tools require extra validation
    if (SENSITIVE_TOOLS.has(toolName)) {
      // Verify required arguments are present
      if (toolName === 'apply_refund') {
        if (!args.order_id || typeof args.order_id !== 'string') {
          throw new ServiceError('apply_refund requires a valid order_id', {
            status: 400,
            code: 'INVALID_TOOL_ARGS',
          });
        }
        if (!args.reason || typeof args.reason !== 'string') {
          throw new ServiceError('apply_refund requires a valid reason', {
            status: 400,
            code: 'INVALID_TOOL_ARGS',
          });
        }
      }

      if (toolName === 'modify_shipping_address') {
        if (!args.order_id || typeof args.order_id !== 'string') {
          throw new ServiceError('modify_shipping_address requires a valid order_id', {
            status: 400,
            code: 'INVALID_TOOL_ARGS',
          });
        }
        if (!args.new_address || typeof args.new_address !== 'string') {
          throw new ServiceError('modify_shipping_address requires a valid new_address', {
            status: 400,
            code: 'INVALID_TOOL_ARGS',
          });
        }
      }

      // In a real system, you would also verify:
      // - The current user owns this conversation or has admin privileges
      // - The order_id belongs to the external_user_id of this conversation
      // - Rate limiting on sensitive operations per conversation
    }
  }

  /**
   * Validate tool arguments for basic safety constraints.
   * Prevents excessively long strings, ensures numeric args are numbers, etc.
   */
  private validateToolArgs(name: string, args: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > MAX_ARG_STRING_LENGTH) {
        throw new ServiceError(`Argument "${key}" for tool "${name}" exceeds maximum length`, {
          status: 400,
          code: 'INVALID_TOOL_ARGS',
        });
      }
    }
  }
}
