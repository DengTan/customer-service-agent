/**
 * P2-B Test 2 — SubAgentService 置信度与降级回归测试
 *
 * R-2: 商品+尺码上下文加成 0.07（只加一次，不重复放大）
 * R-3: 降级场景 degraded=true → 置信度硬上限 0.3
 * R-3: 流内委派透传（通过 calculateSubAgentConfidence 间接验证上下文注入生效）
 */
import { describe, it, expect } from 'vitest';
import { calculateSubAgentConfidence } from './sub-agent-confidence';

describe('SubAgentService — 置信度与降级回归锁定 (R-2 / R-3)', () => {
  const baseChildBot = { tools: [], knowledge_ids: [], delegation_prompt: null };
  const baseMessage = 'test user message';
  const baseResponse = 'This is a decent response with some content here.';

  // ── R-3: 降级场景硬上限 0.3 ──────────────────────────────

  it('degraded=true 时置信度应硬上限为 0.3（无论其他信号）', () => {
    // Provider 未配置时 degraded=true，confidence 必须 = 0.3
    const confidence = calculateSubAgentConfidence(
      { tools: ['query_order_status'], knowledge_ids: ['kb-1'], delegation_prompt: '订单' },
      '我想查一下订单状态',
      '以下是您的订单信息：ORD-2024001',
      true,   // hasProductContext
      true,   // hasSizeChartContext
      true,   // degraded
    );
    expect(confidence).toBe(0.3);
  });

  it('degraded=true 时即便有具体操作结果也不应超出 0.3 上限', () => {
    const confidence = calculateSubAgentConfidence(
      { tools: ['query_order_status'], knowledge_ids: ['kb-1'], delegation_prompt: '订单' },
      '我想查一下订单',
      '订单号：ORD-2024001234，已发货，运单号 SF1234567890', // 含 concrete result
      true,
      true,
      true,
    );
    expect(confidence).toBe(0.3);
  });

  it('degraded=false 时具体操作结果应正常加分', () => {
    const confidence = calculateSubAgentConfidence(
      baseChildBot,
      baseMessage,
      '订单 ORD-2024001234 已发货，运单号 SF1234567890',
      false,
      false,
      false,
    );
    // base 0.5 + concrete result 0.15 = 0.65
    expect(confidence).toBeGreaterThan(0.6);
    expect(confidence).toBeLessThanOrEqual(0.95);
  });

  // ── R-2: 商品+尺码上下文加成 0.07（仅加一次）──────────

  it('hasProductContext=true 时应加 0.07', () => {
    const without = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, false, false);
    const withProduct = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, true, false, false);
    expect(withProduct - without).toBeCloseTo(0.07, 2);
  });

  it('hasSizeChartContext=true 时应加 0.07', () => {
    const without = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, false, false);
    const withSizeChart = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, true, false);
    expect(withSizeChart - without).toBeCloseTo(0.07, 2);
  });

  it('商品+尺码同时存在只加一次 0.07，不重复放大（OR 逻辑）', () => {
    const without = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, false, false);
    const both = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, true, true, false);
    // 应该是 0.07（OR 逻辑），不是 0.14
    expect(both - without).toBeCloseTo(0.07, 2);
    expect(both - without).not.toBeCloseTo(0.14, 2);
  });

  it('hasProductContext=true 时不额外加 hasSizeChartContext=flase 的分', () => {
    // 单独加和两者同时加应该差 0.07，不是 0.14
    const productOnly = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, true, false, false);
    const both = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, true, true, false);
    expect(both - productOnly).toBeCloseTo(0.0, 2); // hasSizeChartContext 不再额外加分
  });

  // ── 基础信号 ───────────────────────────────────────────

  it('无任何信号时基础置信度为 0.5', () => {
    const confidence = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, false, false);
    expect(confidence).toBeCloseTo(0.5, 1);
  });

  it('有 tools 时加 0.05', () => {
    const withoutTools = calculateSubAgentConfidence(
      { ...baseChildBot, tools: [] },
      baseMessage, baseResponse, false, false, false,
    );
    const withTools = calculateSubAgentConfidence(
      { ...baseChildBot, tools: ['query_order_status'] },
      baseMessage, baseResponse, false, false, false,
    );
    expect(withTools - withoutTools).toBeCloseTo(0.05, 2);
  });

  it('有 knowledge_ids 时加 0.05', () => {
    const withoutKb = calculateSubAgentConfidence(
      { ...baseChildBot, knowledge_ids: [] },
      baseMessage, baseResponse, false, false, false,
    );
    const withKb = calculateSubAgentConfidence(
      { ...baseChildBot, knowledge_ids: ['kb-001'] },
      baseMessage, baseResponse, false, false, false,
    );
    expect(withKb - withoutKb).toBeCloseTo(0.05, 2);
  });

  // ── 响应质量评估 ───────────────────────────────────────

  it('短响应（<20字符）应扣 0.1', () => {
    const short = calculateSubAgentConfidence(baseChildBot, baseMessage, 'OK', false, false, false);
    const normal = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, false, false);
    expect(short).toBeLessThan(normal);
    // 0.5 - 0.1 = 0.4
    expect(short).toBeCloseTo(0.4, 1);
  });

  it('含"降级为模板回复"标记应扣 0.2', () => {
    const degraded = calculateSubAgentConfidence(
      baseChildBot, baseMessage, '降级为模板回复：专家处理中', false, false, false,
    );
    const normal = calculateSubAgentConfidence(baseChildBot, baseMessage, baseResponse, false, false, false);
    expect(degraded).toBeLessThan(normal);
  });

  it('置信度上限 0.95', () => {
    const highConfidence = calculateSubAgentConfidence(
      {
        tools: ['t1', 't2', 't3'],
        knowledge_ids: ['k1', 'k2'],
        delegation_prompt: '关键词A 关键词B 关键词C 关键词D 关键词E',
      },
      '关键词A 关键词B 关键词C 关键词D 关键词E',
      '订单号 ORD-2024001234567 已发货，运单号 SF1234567890，请查收',
      true, true, false,
    );
    expect(highConfidence).toBeLessThanOrEqual(0.95);
  });

  it('置信度下限 0.1', () => {
    const lowConfidence = calculateSubAgentConfidence(
      baseChildBot,
      baseMessage,
      '不', // 非常短 + 关键词不匹配
      false, false, false,
    );
    expect(lowConfidence).toBeGreaterThanOrEqual(0.1);
  });

  // ── 导出函数签名与 class 方法一致 ───────────────────────

  it('导出函数签名包含 degraded 参数', () => {
    // TypeScript 编译期检查：确认 degraded 参数存在且为 boolean
    const result = calculateSubAgentConfidence(
      baseChildBot, baseMessage, baseResponse, false, false, true,
    );
    expect(result).toBe(0.3);
  });

  it('导出函数签名包含 hasProductContext 和 hasSizeChartContext 参数', () => {
    // TypeScript 编译期检查
    const result = calculateSubAgentConfidence(
      baseChildBot, baseMessage, baseResponse, true, true, false,
    );
    // 0.5 (base) + 0.07 (OR context) = 0.57
    expect(result).toBeCloseTo(0.57, 1);
  });
});
