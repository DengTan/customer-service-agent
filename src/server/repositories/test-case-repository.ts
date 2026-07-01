/**
 * Test Case Repository
 * Handles CRUD operations for simulation test cases
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { getLogger } from '@/lib/logger';
import type {
  TestCase,
  TestCaseScript,
  TestCaseExpectedOutcome,
  TestCasePriority,
  TestCaseStatus,
  TestCaseCategory,
} from '@/lib/types';
import { trimDemoArray } from '@/lib/api-utils';

const logger = getLogger('TestCase');

export interface CreateTestCaseInput {
  name: string;
  description?: string | null;
  scenario_id?: string | null;
  category?: TestCaseCategory;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  scripts?: TestCaseScript[];
  expected_outcomes?: TestCaseExpectedOutcome[];
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
}

export interface UpdateTestCaseInput {
  name?: string;
  description?: string | null;
  scenario_id?: string | null;
  category?: TestCaseCategory;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  scripts?: TestCaseScript[];
  expected_outcomes?: TestCaseExpectedOutcome[];
  metadata?: Record<string, unknown> | null;
}

export interface TestCaseFilters {
  scenario_id?: string | null;
  category?: TestCaseCategory | null;
  priority?: TestCasePriority | null;
  status?: TestCaseStatus | null;
  search?: string | null;
  created_by?: string | null;
  limit?: number;
  offset?: number;
}

interface TestCaseRow {
  id: string;
  name: string;
  description: string | null;
  scenario_id: string | null;
  category: string;
  priority: string;
  status: string;
  scripts: unknown[];
  expected_outcomes: unknown[];
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

// Demo mode in-memory storage
const demoTestCases: TestCase[] = [];

export class TestCaseRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * Create a new test case
   */
  async create(input: CreateTestCaseInput): Promise<TestCase> {
    if (isDemoMode()) {
      const newTestCase: TestCase = {
        id: `demo-tc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: input.name,
        description: input.description ?? null,
        scenario_id: input.scenario_id ?? null,
        category: input.category ?? 'general',
        priority: input.priority ?? 'medium',
        status: input.status ?? 'draft',
        scripts: input.scripts ?? [],
        expected_outcomes: input.expected_outcomes ?? [],
        metadata: input.metadata ?? null,
        created_by: input.created_by ?? null,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      demoTestCases.push(newTestCase);
      trimDemoArray(demoTestCases);
      logger.info('Created demo test case', { id: newTestCase.id, name: newTestCase.name });
      return newTestCase;
    }

    try {
      const { data, error } = await this.client
        .from('test_cases')
        .insert({
          name: input.name,
          description: input.description ?? null,
          scenario_id: input.scenario_id ?? null,
          category: input.category ?? 'general',
          priority: input.priority ?? 'medium',
          status: input.status ?? 'draft',
          scripts: input.scripts ?? [],
          expected_outcomes: input.expected_outcomes ?? [],
          metadata: input.metadata ?? {},
          created_by: input.created_by ?? null,
        })
        .select()
        .single();

      if (error) throw new RepositoryError('create test case', error.message, error.code);
      logger.info('Created test case', { id: data.id, name: data.name });
      return this.mapRow(data as TestCaseRow);
    } catch (error) {
      logger.errorWithException('Failed to create test case', error, { name: input.name });
      throw error;
    }
  }

  /**
   * List test cases with optional filters
   */
  async list(filters?: TestCaseFilters): Promise<{ items: TestCase[]; total: number }> {
    if (isDemoMode()) {
      let results = [...demoTestCases];

      if (filters?.scenario_id !== undefined) {
        results = results.filter(tc => tc.scenario_id === filters.scenario_id);
      }
      if (filters?.category) {
        results = results.filter(tc => tc.category === filters.category);
      }
      if (filters?.priority) {
        results = results.filter(tc => tc.priority === filters.priority);
      }
      if (filters?.status) {
        results = results.filter(tc => tc.status === filters.status);
      }
      if (filters?.created_by) {
        results = results.filter(tc => tc.created_by === filters.created_by);
      }
      if (filters?.search) {
        const searchLower = filters.search.toLowerCase();
        results = results.filter(tc =>
          tc.name.toLowerCase().includes(searchLower) ||
          tc.description?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by created_at desc
      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = results.length;
      const offset = filters?.offset ?? 0;
      const limit = filters?.limit ?? 20;
      const items = results.slice(offset, offset + limit);

      return { items, total };
    }

    try {
      let query = this.client
        .from('test_cases')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filters?.scenario_id !== undefined) {
        query = query.eq('scenario_id', filters.scenario_id);
      }
      if (filters?.category) {
        query = query.eq('category', filters.category);
      }
      if (filters?.priority) {
        query = query.eq('priority', filters.priority);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.created_by) {
        query = query.eq('created_by', filters.created_by);
      }
      if (filters?.search) {
        query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      if (filters?.offset) {
        query = query.range(filters.offset, (filters.offset + (filters.limit ?? 20)) - 1);
      }

      const { data, error, count } = await query;
      if (error) throw new RepositoryError('list test cases', error.message, error.code);

      const items = (data ?? []).map(row => this.mapRow(row as TestCaseRow));
      logger.debug('Listed test cases', { count: items.length, total: count ?? 0 });
      return { items, total: count ?? 0 };
    } catch (error) {
      logger.errorWithException('Failed to list test cases', error);
      throw error;
    }
  }

  /**
   * Get test case by ID
   */
  async getById(id: string): Promise<TestCase | null> {
    if (isDemoMode()) {
      return demoTestCases.find(tc => tc.id === id) ?? null;
    }

    try {
      const { data, error } = await this.client
        .from('test_cases')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new RepositoryError('get test case', error.message, error.code);
      if (!data) return null;
      return this.mapRow(data as TestCaseRow);
    } catch (error) {
      logger.errorWithException('Failed to get test case', error, { id });
      throw error;
    }
  }

  /**
   * Update an existing test case
   */
  async update(id: string, input: UpdateTestCaseInput): Promise<TestCase> {
    if (isDemoMode()) {
      const testCase = demoTestCases.find(tc => tc.id === id);
      if (!testCase) {
        throw new RepositoryError('update test case', 'Test case not found');
      }
      if (input.name !== undefined) testCase.name = input.name;
      if (input.description !== undefined) testCase.description = input.description;
      if (input.scenario_id !== undefined) testCase.scenario_id = input.scenario_id;
      if (input.category !== undefined) testCase.category = input.category;
      if (input.priority !== undefined) testCase.priority = input.priority;
      if (input.status !== undefined) testCase.status = input.status;
      if (input.scripts !== undefined) testCase.scripts = input.scripts;
      if (input.expected_outcomes !== undefined) testCase.expected_outcomes = input.expected_outcomes;
      if (input.metadata !== undefined) testCase.metadata = input.metadata;
      testCase.updated_at = new Date().toISOString();
      logger.info('Updated demo test case', { id });
      return testCase;
    }

    try {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.scenario_id !== undefined) updates.scenario_id = input.scenario_id;
      if (input.category !== undefined) updates.category = input.category;
      if (input.priority !== undefined) updates.priority = input.priority;
      if (input.status !== undefined) updates.status = input.status;
      if (input.scripts !== undefined) updates.scripts = input.scripts;
      if (input.expected_outcomes !== undefined) updates.expected_outcomes = input.expected_outcomes;
      if (input.metadata !== undefined) updates.metadata = input.metadata;

      const { data, error } = await this.client
        .from('test_cases')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new RepositoryError('update test case', error.message, error.code);
      logger.info('Updated test case', { id });
      return this.mapRow(data);
    } catch (error) {
      logger.errorWithException('Failed to update test case', error, { id });
      throw error;
    }
  }

  /**
   * Delete a test case
   */
  async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = demoTestCases.findIndex(tc => tc.id === id);
      if (index !== -1) {
        demoTestCases.splice(index, 1);
      }
      logger.info('Deleted demo test case', { id });
      return;
    }

    try {
      const { error } = await this.client
        .from('test_cases')
        .delete()
        .eq('id', id);

      if (error) throw new RepositoryError('delete test case', error.message, error.code);
      logger.info('Deleted test case', { id });
    } catch (error) {
      logger.errorWithException('Failed to delete test case', error, { id });
      throw error;
    }
  }

  /**
   * Import test cases from scripts array
   * Converts legacy script format to test case structure
   */
  async importFromScripts(scripts: Array<{
    name: string;
    description?: string;
    scenario_id?: string;
    category?: string;
    priority?: string;
    user_message: string;
    expected_response?: string;
    conditions?: Record<string, unknown>;
  }>, createdBy?: string | null): Promise<TestCase[]> {
    const testCases: TestCase[] = [];

    for (const script of scripts) {
      const testCase = await this.create({
        name: script.name,
        description: script.description,
        scenario_id: script.scenario_id,
        category: (script.category as TestCaseCategory) ?? 'general',
        priority: (script.priority as TestCasePriority) ?? 'medium',
        scripts: [{
          order: 1,
          user_message: script.user_message,
          expected_response: script.expected_response,
          conditions: script.conditions,
        }],
        expected_outcomes: script.expected_response ? [{
          type: 'response_match',
          description: 'AI response matches expected',
          criteria: { contains: script.expected_response },
        }] : [],
        created_by: createdBy,
      });
      testCases.push(testCase);
    }

    logger.info('Imported test cases from scripts', { count: testCases.length });
    return testCases;
  }

  /**
   * Get test case statistics
   */
  async getStats(): Promise<{
    total: number;
    by_status: Record<string, number>;
    by_priority: Record<string, number>;
    by_category: Record<string, number>;
  }> {
    if (isDemoMode()) {
      const by_status: Record<string, number> = {};
      const by_priority: Record<string, number> = {};
      const by_category: Record<string, number> = {};

      for (const tc of demoTestCases) {
        by_status[tc.status] = (by_status[tc.status] ?? 0) + 1;
        by_priority[tc.priority] = (by_priority[tc.priority] ?? 0) + 1;
        by_category[tc.category] = (by_category[tc.category] ?? 0) + 1;
      }

      return {
        total: demoTestCases.length,
        by_status,
        by_priority,
        by_category,
      };
    }

    try {
      const { data, error } = await this.client
        .from('test_cases')
        .select('status, priority, category');

      if (error) throw new RepositoryError('get test case stats', error.message, error.code);

      const by_status: Record<string, number> = {};
      const by_priority: Record<string, number> = {};
      const by_category: Record<string, number> = {};

      for (const row of (data ?? []) as Array<{ status: string; priority: string; category: string }>) {
        by_status[row.status] = (by_status[row.status] ?? 0) + 1;
        by_priority[row.priority] = (by_priority[row.priority] ?? 0) + 1;
        by_category[row.category] = (by_category[row.category] ?? 0) + 1;
      }

      return {
        total: (data ?? []).length,
        by_status,
        by_priority,
        by_category,
      };
    } catch (error) {
      logger.errorWithException('Failed to get test case stats', error);
      throw error;
    }
  }

  /**
   * Map database row to TestCase interface
   */
  private mapRow(row: TestCaseRow): TestCase {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      scenario_id: row.scenario_id ?? null,
      category: row.category as TestCaseCategory,
      priority: row.priority as TestCasePriority,
      status: row.status as TestCaseStatus,
      scripts: Array.isArray(row.scripts) ? row.scripts as TestCaseScript[] : [],
      expected_outcomes: Array.isArray(row.expected_outcomes) ? row.expected_outcomes as TestCaseExpectedOutcome[] : [],
      metadata: row.metadata ?? null,
      created_by: row.created_by ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at ?? null,
    };
  }
}

// Export singleton instance
export const testCaseRepository = new TestCaseRepository();
