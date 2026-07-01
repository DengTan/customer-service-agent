import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

const simTestCaseLogger = logger.database;

export type TestCaseStatus = 'draft' | 'active' | 'archived';

export interface SimulationTestCase {
  id: string;
  name: string;
  description: string | null;
  category: string;
  status: TestCaseStatus;
  scripts: string[]; // Array of test message contents
  expected_outcomes: string | null;
  tags: string[];
  source_conversation_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateTestCaseInput {
  name: string;
  description?: string | null;
  category: string;
  status?: TestCaseStatus;
  scripts: string[];
  expected_outcomes?: string | null;
  tags?: string[];
  source_conversation_id?: string | null;
  created_by: string;
}

export interface UpdateTestCaseInput {
  id: string;
  name?: string;
  description?: string | null;
  category?: string;
  status?: TestCaseStatus;
  scripts?: string[];
  expected_outcomes?: string | null;
  tags?: string[];
}

// Demo mode in-memory storage
const demoTestCases: SimulationTestCase[] = [];

export class SimulationTestCaseRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(
    userId?: string,
    options?: {
      category?: string;
      status?: TestCaseStatus;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ items: SimulationTestCase[]; total: number }> {
    if (isDemoMode()) {
      let result = [...demoTestCases].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      if (userId) {
        result = result.filter(c => c.created_by === userId || c.created_by === null);
      }
      if (options?.category) {
        result = result.filter(c => c.category === options.category);
      }
      if (options?.status) {
        result = result.filter(c => c.status === options.status);
      }
      if (options?.search) {
        const searchLower = options.search.toLowerCase();
        result = result.filter(c =>
          c.name.toLowerCase().includes(searchLower) ||
          (c.description?.toLowerCase().includes(searchLower) ?? false)
        );
      }
      const total = result.length;
      if (options?.offset !== undefined && options?.limit !== undefined) {
        result = result.slice(options.offset, options.offset + options.limit);
      }
      return { items: result, total };
    }

    try {
      let query = this.client
        .from('simulation_test_cases')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (userId) {
        query = query.or(`created_by.eq.${userId},created_by.is.null`);
      }
      if (options?.category) {
        query = query.eq('category', options.category);
      }
      if (options?.status) {
        query = query.eq('status', options.status);
      }
      if (options?.search) {
        query = query.or(`name.ilike.%${options.search}%,description.ilike.%${options.search}%`);
      }
      if (options?.offset !== undefined && options?.limit !== undefined) {
        query = query.range(options.offset, options.offset + options.limit - 1);
      }

      const { data, error, count } = await query;

      if (error) throw new RepositoryError('list test cases', error.message, error.code);
      return { items: (data ?? []) as SimulationTestCase[], total: count ?? 0 };
    } catch (err) {
      simTestCaseLogger.error('[SimulationTestCaseRepository] Database query failed', { error: err });
      return { items: [], total: 0 };
    }
  }

  async getById(id: string): Promise<SimulationTestCase | null> {
    if (isDemoMode()) {
      return demoTestCases.find(c => c.id === id) ?? null;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_test_cases')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new RepositoryError('get test case', error.message, error.code);
      }
      return data as SimulationTestCase;
    } catch (err) {
      simTestCaseLogger.error('[SimulationTestCaseRepository] Database query failed', { error: err });
      return null;
    }
  }

  async create(input: CreateTestCaseInput): Promise<SimulationTestCase> {
    const now = new Date().toISOString();
    const newCase: SimulationTestCase = {
      id: `tc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      status: input.status ?? 'draft',
      scripts: input.scripts,
      expected_outcomes: input.expected_outcomes ?? null,
      tags: input.tags ?? [],
      source_conversation_id: input.source_conversation_id ?? null,
      created_by: input.created_by,
      created_at: now,
      updated_at: now,
    };

    if (isDemoMode()) {
      demoTestCases.unshift(newCase);
      trimDemoArray(demoTestCases);
      return newCase;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_test_cases')
        .insert({
          id: newCase.id,
          name: newCase.name,
          description: newCase.description,
          category: newCase.category,
          status: newCase.status,
          scripts: newCase.scripts,
          expected_outcomes: newCase.expected_outcomes,
          tags: newCase.tags,
          source_conversation_id: newCase.source_conversation_id,
          created_by: newCase.created_by,
          created_at: newCase.created_at,
          updated_at: newCase.updated_at,
        })
        .select('*')
        .single();

      if (error) throw new RepositoryError('create test case', error.message, error.code);
      return data as SimulationTestCase;
    } catch (err) {
      simTestCaseLogger.error('[SimulationTestCaseRepository] Database insert failed', { error: err });
      throw err;
    }
  }

  async update(input: UpdateTestCaseInput): Promise<SimulationTestCase | null> {
    if (isDemoMode()) {
      const index = demoTestCases.findIndex(c => c.id === input.id);
      if (index === -1) return null;
      const updated = {
        ...demoTestCases[index],
        ...input,
        updated_at: new Date().toISOString(),
      };
      demoTestCases[index] = updated;
      return updated;
    }

    try {
      const updates: Partial<SimulationTestCase> = {
        updated_at: new Date().toISOString(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.category !== undefined) updates.category = input.category;
      if (input.status !== undefined) updates.status = input.status;
      if (input.scripts !== undefined) updates.scripts = input.scripts;
      if (input.expected_outcomes !== undefined) updates.expected_outcomes = input.expected_outcomes;
      if (input.tags !== undefined) updates.tags = input.tags;

      const { data, error } = await this.client
        .from('simulation_test_cases')
        .update(updates)
        .eq('id', input.id)
        .select('*')
        .single();

      if (error) throw new RepositoryError('update test case', error.message, error.code);
      return data as SimulationTestCase;
    } catch (err) {
      simTestCaseLogger.error('[SimulationTestCaseRepository] Database update failed', { error: err });
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (isDemoMode()) {
      const index = demoTestCases.findIndex(c => c.id === id);
      if (index !== -1) {
        demoTestCases.splice(index, 1);
        return true;
      }
      return false;
    }

    try {
      const { error } = await this.client
        .from('simulation_test_cases')
        .delete()
        .eq('id', id);

      if (error) throw new RepositoryError('delete test case', error.message, error.code);
      return true;
    } catch (err) {
      simTestCaseLogger.error('[SimulationTestCaseRepository] Database delete failed', { error: err });
      return false;
    }
  }

  async createMany(inputs: CreateTestCaseInput[]): Promise<SimulationTestCase[]> {
    if (inputs.length === 0) return [];

    const now = new Date().toISOString();
    const newCases: SimulationTestCase[] = inputs.map((input, idx) => ({
      id: `tc-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 8)}`,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      status: input.status ?? 'draft',
      scripts: input.scripts,
      expected_outcomes: input.expected_outcomes ?? null,
      tags: input.tags ?? [],
      source_conversation_id: input.source_conversation_id ?? null,
      created_by: input.created_by,
      created_at: now,
      updated_at: now,
    }));

    if (isDemoMode()) {
      demoTestCases.unshift(...newCases);
      trimDemoArray(demoTestCases);
      return newCases;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_test_cases')
        .insert(newCases.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          category: c.category,
          status: c.status,
          scripts: c.scripts,
          expected_outcomes: c.expected_outcomes,
          tags: c.tags,
          source_conversation_id: c.source_conversation_id,
          created_by: c.created_by,
          created_at: c.created_at,
          updated_at: c.updated_at,
        })))
        .select('*');

      if (error) throw new RepositoryError('create many test cases', error.message, error.code);
      return (data ?? []) as SimulationTestCase[];
    } catch (err) {
      simTestCaseLogger.error('[SimulationTestCaseRepository] Database bulk insert failed', { error: err });
      throw err;
    }
  }
}

export const simulationTestCaseRepository = new SimulationTestCaseRepository();
