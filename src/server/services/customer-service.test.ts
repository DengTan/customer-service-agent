import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

import { CustomerService } from '@/server/services/customer-service';
import { ServiceError } from '@/server/services/service-error';
import type { ActorAccessContext } from '@/server/repositories/customer-repository';
import { RepositoryError } from '@/server/repositories/repository-error';

type Role = 'admin' | 'agent' | 'observer';

const ACTOR = (role: Role, userId: string): ActorAccessContext => ({ userId, role });

/**
 * Builds a fake CustomerRepository that wires up only the methods the access
 * check + fetch pipeline call. The conversation ↔ customer graph and queue
 * membership is fully controlled per-test via the mocks.
 */
function makeFakeRepo(opts: {
  /** conversation_id -> customer_id mapping for customer_conversations */
  convToCustomer: Record<string, string>;
  /** conversation_id -> customer_id mapping for findByConversationId */
  customerByConv: Record<string, { id: string; name: string; phone: string | null; email: string | null } | null>;
  /** conversation -> participant_ids */
  convParticipants: Record<string, string[]>;
  /** conversation -> assigned_agent_id in agent_queue */
  convAssignedAgents: Record<string, string[]>;
  /** customers returned by getWithConversations (keyed by id) */
  customersById: Record<string, { id: string; name: string }>;
  /** conversations list for getWithConversations */
  convsByCustomer: Record<string, Array<{ id: string; title: string; status: string }>>;
}) {
  return {
    findByConversationId: vi.fn(async (convId: string) => opts.customerByConv[convId] ?? null),
    findCustomerConversationLink: vi.fn(async (convId: string) => {
      const customerId = opts.convToCustomer[convId];
      return customerId ? { customer_id: customerId } : null;
    }),
    canActorAccessConversation: vi.fn(async (actor: ActorAccessContext, convId: string) => {
      if (actor.role === 'admin') return true;
      const participants = opts.convParticipants[convId] ?? [];
      if (participants.includes(actor.userId)) return true;
      const assigned = opts.convAssignedAgents[convId] ?? [];
      if (assigned.includes(actor.userId)) return true;
      return false;
    }),
    canActorAccessCustomer: vi.fn(async (actor: ActorAccessContext, customerId: string) => {
      if (actor.role === 'admin') return true;
      const convIds = Object.keys(opts.convToCustomer).filter(cid => opts.convToCustomer[cid] === customerId);
      for (const convId of convIds) {
        const participants = opts.convParticipants[convId] ?? [];
        if (participants.includes(actor.userId)) return true;
        const assigned = opts.convAssignedAgents[convId] ?? [];
        if (assigned.includes(actor.userId)) return true;
      }
      return false;
    }),
    getWithConversations: vi.fn(async (id: string) => ({
      customer: opts.customersById[id] ?? null,
      conversations: opts.convsByCustomer[id] ?? [],
    })),
    update: vi.fn(async (input: { id: string }) => ({ id: input.id, name: 'updated' })),
    list: vi.fn(async () => ({ customers: [], total: 0, page: 1, pageSize: 20 })),
    get: vi.fn(async () => ({ id: 'x' })),
    findById: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'x' })),
    delete: vi.fn(async () => undefined),
  };
}

describe('CustomerService — row-level access control', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ─── getCustomerByConversationId ─────────────────────────────────────

  describe('getCustomerByConversationId', () => {
    it('admin: always allowed', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: { conv1: { id: 'cust1', name: 'Alice', phone: '13800000001', email: 'a@x.com' } },
        convParticipants: { conv1: ['other-agent'] },
        convAssignedAgents: { conv1: [] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      const result = await svc.getCustomerByConversationId(ACTOR('admin', 'admin-1'), 'conv1');
      expect(result?.id).toBe('cust1');
    });

    it('agent: participant — allowed', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: { conv1: { id: 'cust1', name: 'Alice', phone: null, email: null } },
        convParticipants: { conv1: ['agent-7'] },
        convAssignedAgents: { conv1: [] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      const result = await svc.getCustomerByConversationId(ACTOR('agent', 'agent-7'), 'conv1');
      expect(result?.id).toBe('cust1');
    });

    it('agent: assigned via agent_queue — allowed', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: { conv1: { id: 'cust1', name: 'Alice', phone: null, email: null } },
        convParticipants: { conv1: [] },
        convAssignedAgents: { conv1: ['agent-8'] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      const result = await svc.getCustomerByConversationId(ACTOR('agent', 'agent-8'), 'conv1');
      expect(result?.id).toBe('cust1');
    });

    it('agent: not participant nor assigned — forbidden (403)', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: { conv1: { id: 'cust1', name: 'Alice', phone: null, email: null } },
        convParticipants: { conv1: ['other-agent'] },
        convAssignedAgents: { conv1: ['other-agent'] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      await expect(
        svc.getCustomerByConversationId(ACTOR('agent', 'agent-9'), 'conv1'),
      ).rejects.toBeInstanceOf(ServiceError);
      try {
        await svc.getCustomerByConversationId(ACTOR('agent', 'agent-9'), 'conv1');
      } catch (err) {
        expect((err as ServiceError).status).toBe(403);
        expect((err as ServiceError).code).toBe('FORBIDDEN');
      }
    });

    it('observer: participant — allowed; not participant — forbidden', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: { conv1: { id: 'cust1', name: 'Alice', phone: null, email: null } },
        convParticipants: { conv1: ['obs-1'] },
        convAssignedAgents: { conv1: [] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      // participant → allowed
      const ok = await svc.getCustomerByConversationId(ACTOR('observer', 'obs-1'), 'conv1');
      expect(ok?.id).toBe('cust1');

      // not participant → 403
      await expect(
        svc.getCustomerByConversationId(ACTOR('observer', 'obs-2'), 'conv1'),
      ).rejects.toBeInstanceOf(ServiceError);
    });
  });

  // ─── getCustomer (by id) ─────────────────────────────────────────────

  describe('getCustomer', () => {
    it('admin: any customer — allowed', async () => {
      const repo = makeFakeRepo({
        convToCustomer: {},
        customerByConv: {},
        convParticipants: {},
        convAssignedAgents: {},
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [{ id: 'conv1', title: 'Hi', status: 'completed' }] },
      });
      const svc = new CustomerService(repo as never);

      const result = await svc.getCustomer(ACTOR('admin', 'admin-1'), 'cust1');
      expect(result.customer.id).toBe('cust1');
      expect(result.conversations.length).toBe(1);
    });

    it('agent: customer with a conversation the agent owns — allowed', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: {},
        convParticipants: { conv1: ['agent-7'] },
        convAssignedAgents: { conv1: [] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [{ id: 'conv1', title: 'Hi', status: 'active' }] },
      });
      const svc = new CustomerService(repo as never);

      const result = await svc.getCustomer(ACTOR('agent', 'agent-7'), 'cust1');
      expect(result.customer.id).toBe('cust1');
    });

    it('agent: no link to any of the customer\'s conversations — 404 (no existence leak)', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1', conv2: 'cust1' },
        customerByConv: {},
        convParticipants: { conv1: ['other'], conv2: ['other'] },
        convAssignedAgents: { conv1: ['other'], conv2: ['other'] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      try {
        await svc.getCustomer(ACTOR('agent', 'agent-9'), 'cust1');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).status).toBe(404);
        expect((err as ServiceError).code).toBe('NOT_FOUND');
      }
    });

    it('observer: not participant in any of customer\'s conversations — 404', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: {},
        convParticipants: { conv1: ['other'] },
        convAssignedAgents: { conv1: [] },
        customersById: { cust1: { id: 'cust1', name: 'Alice' } },
        convsByCustomer: { cust1: [] },
      });
      const svc = new CustomerService(repo as never);

      await expect(
        svc.getCustomer(ACTOR('observer', 'obs-1'), 'cust1'),
      ).rejects.toBeInstanceOf(ServiceError);
    });
  });

  // ─── updateCustomer ──────────────────────────────────────────────────

  describe('updateCustomer', () => {
    it('agent: cannot update customer they have no link to', async () => {
      const repo = makeFakeRepo({
        convToCustomer: { conv1: 'cust1' },
        customerByConv: {},
        convParticipants: { conv1: ['other'] },
        convAssignedAgents: { conv1: [] },
        customersById: {},
        convsByCustomer: {},
      });
      const svc = new CustomerService(repo as never);

      try {
        await svc.updateCustomer(ACTOR('agent', 'agent-9'), { id: 'cust1', tags: ['vip'] });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).status).toBe(404);
      }
      // Repository.update must NOT have been called
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('admin: update proceeds to repository', async () => {
      const repo = makeFakeRepo({
        convToCustomer: {},
        customerByConv: {},
        convParticipants: {},
        convAssignedAgents: {},
        customersById: {},
        convsByCustomer: {},
      });
      const svc = new CustomerService(repo as never);

      await svc.updateCustomer(ACTOR('admin', 'admin-1'), { id: 'cust1', tags: ['vip'] });
      expect(repo.update).toHaveBeenCalledOnce();
    });
  });

  // ─── listAccessibleCustomers ─────────────────────────────────────────

  describe('listAccessibleCustomers', () => {
    it('admin: delegates to listAccessible which short-circuits to list()', async () => {
      const listAccessible = vi.fn(async () => ({
        customers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        total: 3,
        page: 1,
        pageSize: 20,
      }));
      const list = vi.fn(async () => ({ customers: [{ id: 'x' }], total: 1, page: 1, pageSize: 20 }));
      const canActorAccessCustomer = vi.fn(async () => true);
      const repo = { listAccessible, list, canActorAccessCustomer };
      const svc = new CustomerService(repo as never);

      const r = await svc.listAccessibleCustomers(ACTOR('admin', 'admin-1'), {});
      expect(r.total).toBe(3);
      expect(r.customers).toHaveLength(3);
      expect(listAccessible).toHaveBeenCalledOnce();
      // admin path is enforced inside the repo's listAccessible → list()
      expect(repo.canActorAccessCustomer).not.toHaveBeenCalled();
    });

    it('agent: delegates to listAccessible (no per-customer access loop)', async () => {
      const listAccessible = vi.fn(async () => ({
        customers: [{ id: 'a' }],
        total: 1,
        page: 1,
        pageSize: 20,
      }));
      const list = vi.fn(async () => ({ customers: [], total: 0, page: 1, pageSize: 20 }));
      const canActorAccessCustomer = vi.fn(async () => true);
      const repo = { listAccessible, list, canActorAccessCustomer };
      const svc = new CustomerService(repo as never);

      const r = await svc.listAccessibleCustomers(ACTOR('agent', 'agent-7'), { search: 'ali' });
      expect(r.customers).toHaveLength(1);
      expect((r.customers[0] as { id: string }).id).toBe('a');
      // The service must not iterate with canActorAccessCustomer; access
      // enforcement happens inside listAccessible's single SQL query.
      expect(repo.canActorAccessCustomer).not.toHaveBeenCalled();
      expect(listAccessible).toHaveBeenCalledOnce();
      // filters passed through, actor passed through
      const firstCall = listAccessible.mock.calls[0] as unknown as [
        Record<string, unknown>,
        ActorAccessContext,
      ];
      expect(firstCall[0]).toEqual({ search: 'ali' });
      expect(firstCall[1].userId).toBe('agent-7');
      expect(firstCall[1].role).toBe('agent');
    });

    it('observer: delegates to listAccessible (same access rules as agent)', async () => {
      const listAccessible = vi.fn(async () => ({
        customers: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }));
      const repo = { listAccessible, list: vi.fn(), canActorAccessCustomer: vi.fn() };
      const svc = new CustomerService(repo as never);

      const r = await svc.listAccessibleCustomers(ACTOR('observer', 'obs-1'), { page: 2, pageSize: 10 });
      expect(r.total).toBe(0);
      expect(listAccessible).toHaveBeenCalledOnce();
      const firstCall = listAccessible.mock.calls[0] as unknown as [
        Record<string, unknown>,
        ActorAccessContext,
      ];
      expect(firstCall[1].role).toBe('observer');
      expect(firstCall[0]).toEqual({ page: 2, pageSize: 10 });
    });

    it('wraps repository errors with DB_QUERY_ERROR code', async () => {
      const listAccessible = vi.fn(async () => {
        throw new RepositoryError('list accessible customers', 'boom', 'PGRST_ERROR');
      });
      const repo = { listAccessible, list: vi.fn(), canActorAccessCustomer: vi.fn() };
      const svc = new CustomerService(repo as never);

      try {
        await svc.listAccessibleCustomers(ACTOR('agent', 'agent-7'), {});
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).code).toBe('DB_QUERY_ERROR');
        expect((err as ServiceError).status).toBe(500);
      }
    });
  });

  // ─── Negative test: no role bypass ──────────────────────────────────

  it('actor with no role: refuses (defensive)', async () => {
    const repo = makeFakeRepo({
      convToCustomer: { conv1: 'cust1' },
      customerByConv: { conv1: { id: 'cust1', name: 'X', phone: null, email: null } },
      convParticipants: { conv1: ['admin-1'] },
      convAssignedAgents: { conv1: [] },
      customersById: {},
      convsByCustomer: {},
    });
    const svc = new CustomerService(repo as never);

    // Bypass TypeScript with a `null` role to verify defensive guard.
    const badActor = { userId: 'x', role: null } as unknown as ActorAccessContext;
    await expect(
      svc.getCustomerByConversationId(badActor, 'conv1'),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});