/**
 * P0-D — Tool 鉴权对所有工具都跑会话校验
 *
 * Fix: verifyToolAuthorization() now returns early for non-sensitive tools
 * (query_size_chart / query_order_status / query_logistics / query_product_detail),
 * skipping the unconditional ConversationRepository.findById() call.
 *
 * Regression targets:
 * - T-1: Non-sensitive tools must NOT call findById.
 * - T-2: Sensitive tools (apply_refund / modify_shipping_address) still call findById.
 * - T-3: Sensitive tool + ended conversation still throws CONVERSATION_ENDED.
 * - T-4: Sensitive tool + missing conversation still throws NOT_FOUND.
 * - T-5: Sensitive tool + invalid args still throws INVALID_TOOL_ARGS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionService } from './tool-execution-service';
import { ConversationRepository } from '@/server/repositories/conversation-repository';
import { ServiceError } from './service-error';

vi.mock('@/server/repositories/conversation-repository');

describe('ToolExecutionService — verifyToolAuthorization (P0-D)', () => {
  let service: ToolExecutionService;
  let mockFindById: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ToolExecutionService();
    mockFindById = vi.spyOn(ConversationRepository.prototype, 'findById');
  });

  // ── T-1: Non-sensitive tools must NOT call findById ────────────────────────

  it('T-1a: query_size_chart must not call findById', async () => {
    await service.verifyToolAuthorization('conv-123', 'query_size_chart', { sku: 'SKU001' });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('T-1b: query_order_status must not call findById', async () => {
    await service.verifyToolAuthorization('conv-123', 'query_order_status', { order_id: 'ORD-001' });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('T-1c: query_logistics must not call findById', async () => {
    await service.verifyToolAuthorization('conv-123', 'query_logistics', { tracking_number: 'SF123' });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('T-1d: query_product_detail must not call findById', async () => {
    await service.verifyToolAuthorization('conv-123', 'query_product_detail', { sku: 'SKU001' });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('T-1e: unknown tool must not call findById', async () => {
    await service.verifyToolAuthorization('conv-123', 'unknown_tool', {});
    expect(mockFindById).not.toHaveBeenCalled();
  });

  // ── T-2: Sensitive tools still call findById ──────────────────────────────

  it('T-2a: apply_refund must call findById', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'active' } as never);
    await service.verifyToolAuthorization('conv-123', 'apply_refund', {
      order_id: 'ORD-001',
      reason: '不喜欢',
    });
    expect(mockFindById).toHaveBeenCalledOnce();
    expect(mockFindById).toHaveBeenCalledWith('conv-123');
  });

  it('T-2b: modify_shipping_address must call findById', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'active' } as never);
    await service.verifyToolAuthorization('conv-123', 'modify_shipping_address', {
      order_id: 'ORD-001',
      new_address: '北京市朝阳区',
    });
    expect(mockFindById).toHaveBeenCalledOnce();
    expect(mockFindById).toHaveBeenCalledWith('conv-123');
  });

  // ── T-3: Sensitive tool + ended conversation throws CONVERSATION_ENDED ─────

  it('T-3a: apply_refund + ended conversation throws CONVERSATION_ENDED', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'ended' } as never);
    await expect(
      service.verifyToolAuthorization('conv-123', 'apply_refund', {
        order_id: 'ORD-001',
        reason: '不喜欢',
      }),
    ).rejects.toThrow(ServiceError);
    try {
      await service.verifyToolAuthorization('conv-123', 'apply_refund', {
        order_id: 'ORD-001',
        reason: '不喜欢',
      });
    } catch (err) {
      expect((err as ServiceError).code).toBe('CONVERSATION_ENDED');
    }
  });

  it('T-3b: modify_shipping_address + ended conversation throws CONVERSATION_ENDED', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'ended' } as never);
    await expect(
      service.verifyToolAuthorization('conv-123', 'modify_shipping_address', {
        order_id: 'ORD-001',
        new_address: '北京市朝阳区',
      }),
    ).rejects.toMatchObject({ code: 'CONVERSATION_ENDED' });
  });

  // ── T-4: Sensitive tool + missing conversation throws NOT_FOUND ────────────

  it('T-4: missing conversation throws NOT_FOUND', async () => {
    mockFindById.mockResolvedValue(null);
    await expect(
      service.verifyToolAuthorization('conv-999', 'apply_refund', {
        order_id: 'ORD-001',
        reason: '不喜欢',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── T-5: Sensitive tool + invalid args throws INVALID_TOOL_ARGS ─────────

  it('T-5a: apply_refund without order_id throws INVALID_TOOL_ARGS', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'active' } as never);
    await expect(
      service.verifyToolAuthorization('conv-123', 'apply_refund', { reason: '不喜欢' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGS' });
  });

  it('T-5b: apply_refund without reason throws INVALID_TOOL_ARGS', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'active' } as never);
    await expect(
      service.verifyToolAuthorization('conv-123', 'apply_refund', { order_id: 'ORD-001' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGS' });
  });

  it('T-5c: modify_shipping_address without new_address throws INVALID_TOOL_ARGS', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'active' } as never);
    await expect(
      service.verifyToolAuthorization('conv-123', 'modify_shipping_address', {
        order_id: 'ORD-001',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGS' });
  });

  it('T-5d: modify_shipping_address without order_id throws INVALID_TOOL_ARGS', async () => {
    mockFindById.mockResolvedValue({ id: 'conv-123', status: 'active' } as never);
    await expect(
      service.verifyToolAuthorization('conv-123', 'modify_shipping_address', {
        new_address: '北京市朝阳区',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL_ARGS' });
  });
});
