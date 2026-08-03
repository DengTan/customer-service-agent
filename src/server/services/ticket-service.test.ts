import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn(),
  isDemoMode: () => false,
}));

vi.mock('@/server/repositories/alert-repository', () => ({
  AlertRepository: class {
    create = vi.fn();
    update = vi.fn();
    resolve = vi.fn();
    findById = vi.fn();
    list = vi.fn();
  },
}));

vi.mock('@/server/repositories/settings-repository', () => ({
  SettingsRepository: class {
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn();
    // ticket_sla_enabled='true' makes getSLAConfig return enabled=true (its default path).
    list = vi.fn().mockResolvedValue([
      { key: 'ticket_sla_enabled', value: 'true' },
    ]);
  },
}));

vi.mock('@/server/repositories/conversation-repository', () => ({
  ConversationRepository: class {
    update = vi.fn();
    findStatus = vi.fn();
    insertMessage = vi.fn();
  },
}));

vi.mock('@/server/repositories/ticket-custom-field-repository', () => ({
  getCategories: vi.fn().mockResolvedValue([]),
  getCustomFields: vi.fn().mockResolvedValue([]),
  getFieldValues: vi.fn().mockResolvedValue([]),
  upsertFieldValues: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { TicketService } from '@/server/services/ticket-service';

describe('TicketService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listTickets', () => {
    it('returns paginated ticket list', async () => {
      const mockTickets = [
        { id: '1', title: 'Test Ticket 1', status: 'open' },
        { id: '2', title: 'Test Ticket 2', status: 'in_progress' },
      ];

      const mockRepo = {
        list: vi.fn().mockResolvedValue({
          tickets: mockTickets,
          status_counts: { open: 0, in_progress: 0, resolved: 0, closed: 0 },
          total_count: 50,
          page: 1,
          page_size: 20,
        }),
      };

      const service = new TicketService(mockRepo as never);

      const result = await service.listTickets({ page: 1, page_size: 20 });

      expect(result.tickets).toHaveLength(2);
      expect(result.total_count).toBe(50);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
    });

    it('filters tickets by status', async () => {
      const mockRepo = {
        list: vi.fn().mockResolvedValue({
          tickets: [{ id: '1', title: 'Open Ticket', status: 'open' }],
          total: 1,
        }),
      };

      const service = new TicketService(mockRepo as never);

      const result = await service.listTickets({ page: 1, page_size: 20, status: 'open' });

      expect(result.tickets).toHaveLength(1);
      expect(result.tickets[0].status).toBe('open');
    });
  });

  describe('getTicket', () => {
    it('returns ticket with details', async () => {
      const mockTicket = {
        id: 'ticket-1',
        title: 'Test Ticket',
        status: 'open',
        priority: 'high',
        category: 'refund',
      };

      const mockRepo = {
        getDetail: vi.fn().mockResolvedValue(mockTicket),
      };

      const service = new TicketService(mockRepo as never);

      const result = await service.getTicket('ticket-1');

      expect(result).toMatchObject(mockTicket);
    });
  });

  describe('getSLAConfig', () => {
    it('returns default SLA config', async () => {
      // Settings mock returns ticket_sla_enabled=true so the service
      // emits { enabled: true, responseMinutes: {...}, resolveMinutes: {...} }.
      // The test verifies the contract: enabled is true, both maps are present.
      const service = new TicketService({} as never);

      const result = await service.getSLAConfig();

      expect(result.enabled).toBe(true);
      expect(result.responseMinutes).toBeDefined();
      expect(result.resolveMinutes).toBeDefined();
    });
  });

  describe('updateTicket validation', () => {
    it('throws error for invalid status transition', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'ticket-1',
          title: 'Test',
          status: 'closed',
        }),
      };

      const service = new TicketService(mockRepo as never);

      // closed -> open is not a valid transition
      await expect(
        service.updateTicket({ id: 'ticket-1', status: 'open' as never })
      ).rejects.toThrow();
    });
  });

  describe('createTicket', () => {
    it('creates ticket with valid input', async () => {
      const mockRepo = {
        create: vi.fn().mockResolvedValue({
          id: 'new-ticket-1',
          title: 'New Ticket',
          status: 'open',
        }),
        // createTicket calls logStatusChange after insert.
        logStatusChange: vi.fn().mockResolvedValue(undefined),
      };

      const service = new TicketService(mockRepo as never);

      const result = await service.createTicket({
        title: 'New Ticket',
        description: 'Test description',
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        title: 'New Ticket',
        description: 'Test description',
      });
    });

    it('rejects ticket without title', async () => {
      const mockRepo = {
        create: vi.fn(),
      };

      const service = new TicketService(mockRepo as never);

      await expect(
        service.createTicket({ title: '' } as never)
      ).rejects.toThrow();
    });
  });

  describe('getCategories', () => {
    it('returns list of categories', async () => {
      const mockRepo = {};
      const service = new TicketService(mockRepo as never);

      const result = await service.getCategories();

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
