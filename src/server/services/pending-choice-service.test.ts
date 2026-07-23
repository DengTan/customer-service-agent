import { describe, it, expect, beforeEach } from 'vitest';
import { PendingChoiceService } from './pending-choice-service';

const NOW = 1700000000000;
const FIXED_TTL = 60_000;

function makeService() {
  const svc = new PendingChoiceService(FIXED_TTL);
  return svc;
}

describe('PendingChoiceService', () => {
  let svc: PendingChoiceService;

  beforeEach(() => {
    svc = makeService();
  });

  describe('create', () => {
    it('creates a choice and returns an id', () => {
      const id = svc.create({
        conversationId: 'conv-1',
        payload: { tool: 'order_query', args: { orderId: 'ORD-001' } },
        description: '查询订单 ORD-001',
      });
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(id!.startsWith('pc_')).toBe(true);
    });

    it('returns null for duplicate id (idempotent — does not overwrite)', () => {
      const params = {
        conversationId: 'conv-1',
        payload: { tool: 'order_query' },
        description: 'test',
      };
      const id = svc.create(params);
      const again = svc.create(params);
      // The second create with same conversationId creates a DIFFERENT id
      expect(again).not.toBeNull();
      expect(again).not.toBe(id);
    });
  });

  describe('get', () => {
    it('returns the choice when it exists and is not expired', () => {
      const id = svc.create({
        conversationId: 'conv-1',
        payload: { tool: 'order_query' },
        description: 'test',
      });
      const found = svc.get('conv-1', id!);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.payload).toEqual({ tool: 'order_query' });
    });

    it('returns null for nonexistent choice', () => {
      expect(svc.get('conv-1', 'pc_nonexistent')).toBeNull();
    });
  });

  describe('consume', () => {
    it('deletes the choice and returns true', () => {
      const id = svc.create({
        conversationId: 'conv-1',
        payload: { tool: 'order_query' },
        description: 'test',
      });
      const result = svc.consume('conv-1', id!);
      expect(result).toBe(true);
      expect(svc.get('conv-1', id!)).toBeNull();
    });

    it('returns false for nonexistent choice', () => {
      expect(svc.consume('conv-1', 'pc_nonexistent')).toBe(false);
    });
  });

  describe('listForConversation', () => {
    it('returns all unexpired choices for a conversation', () => {
      const id1 = svc.create({ conversationId: 'conv-1', payload: {}, description: 'a' });
      const id2 = svc.create({ conversationId: 'conv-1', payload: {}, description: 'b' });
      svc.create({ conversationId: 'conv-2', payload: {}, description: 'c' });

      const list = svc.listForConversation('conv-1');
      expect(list).toHaveLength(2);
      expect(list.map(c => c.id).sort()).toEqual([id1!, id2!].sort());
    });

    it('does not include choices from other conversations', () => {
      svc.create({ conversationId: 'conv-1', payload: {}, description: 'a' });
      svc.create({ conversationId: 'conv-2', payload: {}, description: 'b' });

      expect(svc.listForConversation('conv-1')).toHaveLength(1);
      expect(svc.listForConversation('conv-2')).toHaveLength(1);
    });
  });

  describe('clearConversation', () => {
    it('removes all choices for a conversation', () => {
      svc.create({ conversationId: 'conv-1', payload: {}, description: 'a' });
      svc.create({ conversationId: 'conv-1', payload: {}, description: 'b' });
      svc.create({ conversationId: 'conv-2', payload: {}, description: 'c' });

      svc.clearConversation('conv-1');

      expect(svc.listForConversation('conv-1')).toHaveLength(0);
      expect(svc.listForConversation('conv-2')).toHaveLength(1);
    });
  });

  describe('size', () => {
    it('returns the count of unexpired choices', () => {
      svc.create({ conversationId: 'conv-1', payload: {}, description: 'a' });
      svc.create({ conversationId: 'conv-1', payload: {}, description: 'b' });
      expect(svc.size).toBe(2);
      svc.consume('conv-1', svc.listForConversation('conv-1')[0].id);
      expect(svc.size).toBe(1);
    });
  });

  describe('metadata', () => {
    it('stores metadata on the choice', () => {
      const id = svc.create({
        conversationId: 'conv-1',
        payload: {},
        description: 'test',
        metadata: { span: 'turn_2', citationCount: 5 },
      });
      const found = svc.get('conv-1', id!);
      expect(found!.metadata).toEqual({ span: 'turn_2', citationCount: 5 });
    });
  });
});
