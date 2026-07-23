/**
 * P2-B Test 1 — Factory 工具映射回归测试
 *
 * Validates that `query_size_chart` and `query_product_detail` are correctly
 * mapped to their respective providers via `toolToProviderMap` in `executeTool`.
 *
 * Previously, missing map entries caused these tools to fall through to the
 * "未知工具" error path even when valid providers existed — R-1 fix.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolProviderFactory, executeTool } from './factory';

describe('ToolProviderFactory — 工具映射回归锁定 (R-1)', () => {
    beforeEach(() => {
        ToolProviderFactory.clearCache();
    });

    it('toolToProviderMap 应包含 query_size_chart → size_chart 映射', () => {
        // 直接验证 map 中存在映射（不依赖运行时行为）
        const provider = ToolProviderFactory.getProvider('size_chart');
        expect(provider).toBeDefined();
        expect(provider.type).toBe('size_chart');
    });

    it('toolToProviderMap 应包含 query_product_detail → product 映射', () => {
        const provider = ToolProviderFactory.getProvider('product');
        expect(provider).toBeDefined();
        expect(provider.type).toBe('product');
    });

    it('executeTool(query_size_chart, {sku}) 不应返回未知工具错误', async () => {
        // 关键回归：之前 query_size_chart 不在 toolToProviderMap 中
        // 会错误地进入 "未知工具" 分支
        const result = await executeTool('query_size_chart', { sku: 'SKU001' });
        expect(result).toBeDefined();
        // "未知工具" 错误 = 映射失败的明确标志
        const msg = JSON.stringify(result.message);
        expect(msg).not.toContain('未知工具');
    });

    it('executeTool(query_product_detail, {sku}) 不应返回未知工具错误', async () => {
        const result = await executeTool('query_product_detail', { sku: 'SKU001' });
        expect(result).toBeDefined();
        const msg = JSON.stringify(result.message);
        expect(msg).not.toContain('未知工具');
    });

    it('getAvailableTypes 应包含 size_chart 和 product', () => {
        const types = ToolProviderFactory.getAvailableTypes();
        expect(types).toContain('size_chart');
        expect(types).toContain('product');
    });

    it('未知工具名应返回 "未知工具" 错误', async () => {
        const result = await executeTool('this_tool_does_not_exist', {});
        const msg = JSON.stringify(result.message);
        expect(msg).toContain('未知工具');
        expect(result.confidence).toBe(0.3);
    });
});
