import { describe, it, expect } from 'vitest';
import { stripInternalMarkersFromResponse } from './strip-markers';

describe('stripInternalMarkersFromResponse', () => {
  it('strips tool call markers with hyphenated tool names', () => {
    expect(
      stripInternalMarkersFromResponse('[TOOL_CALL]order-query|{}[/TOOL_CALL]  退款政策')
    ).toBe('退款政策');
  });

  it('strips tool call markers with populated JSON bodies', () => {
    expect(
      stripInternalMarkersFromResponse('[TOOL_CALL]query_order_status|{"order_id":"123"}[/TOOL_CALL] 您好')
    ).toBe('您好');
  });

  it('strips CONF markers with decimal confidence', () => {
    expect(stripInternalMarkersFromResponse('回答内容[CONF:0.85]')).toBe('回答内容');
  });

  it('strips CONF markers with description', () => {
    expect(stripInternalMarkersFromResponse('回答内容[CONF:0.95 (high)]')).toBe('回答内容');
  });

  it('strips full-width CONF markers', () => {
    expect(stripInternalMarkersFromResponse('回答内容【CONF:0.8】')).toBe('回答内容');
  });

  it('strips DELEGATE_TO markers', () => {
    expect(
      stripInternalMarkersFromResponse('[DELEGATE_TO]refund-agent|{"reason":"duplicate"}[/DELEGATE_TO] 请稍等')
    ).toBe('请稍等');
  });

  it('strips PENDING_CHOICE markers', () => {
    expect(stripInternalMarkersFromResponse('[PENDING_CHOICE:refund][CONF:0.7]')).toBe('');
  });

  it('preserves [IMG:url](alt) image references', () => {
    const input = '退换货流程图：[IMG:https://example.com/refund.png](退换货流程图)';
    expect(stripInternalMarkersFromResponse(input)).toBe(input);
  });

  it('collapses extra blank lines', () => {
    expect(
      stripInternalMarkersFromResponse('第一段\n\n\n\n第二段')
    ).toBe('第一段\n\n第二段');
  });

  it('trims leading and trailing whitespace', () => {
    expect(
      stripInternalMarkersFromResponse('  内容  ')
    ).toBe('内容');
  });

  it('handles empty input', () => {
    expect(stripInternalMarkersFromResponse('')).toBe('');
  });

  it('handles null-ish input', () => {
    // @ts-expect-error testing runtime behavior
    expect(stripInternalMarkersFromResponse(null)).toBe('');
    // @ts-expect-error testing runtime behavior
    expect(stripInternalMarkersFromResponse(undefined)).toBe('');
  });
});
