/**
 * Simulation Evaluation Repository
 * Handles CRUD operations for simulation message evaluations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { getLogger } from '@/lib/logger';
import type { SimulationEvaluation } from '@/lib/types';
import { trimDemoArray } from '@/lib/api-utils';

const logger = getLogger('SimulationEvaluation');

export interface CreateSimulationEvaluationInput {
  simulation_id: string;
  user_id?: string | null;
  message_id: string;
  rating: number;
  tags?: string[];
  comment?: string | null;
}

export interface UpdateSimulationEvaluationInput {
  rating?: number;
  tags?: string[];
  comment?: string | null;
}

export interface SimulationEvaluationFilters {
  simulation_id?: string;
  message_id?: string;
  user_id?: string;
  min_rating?: number;
  max_rating?: number;
  limit?: number;
}

interface SimulationEvaluationRow {
  id: string;
  simulation_id: string;
  user_id: string | null;
  message_id: string;
  rating: number;
  tags: string[];
  comment: string | null;
  created_at: string;
}

// Demo mode in-memory storage
const demoEvaluations: SimulationEvaluation[] = [];

export class SimulationEvaluationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  /**
   * Create a new simulation evaluation
   */
  async create(input: CreateSimulationEvaluationInput): Promise<SimulationEvaluation> {
    if (isDemoMode()) {
      const newEvaluation: SimulationEvaluation = {
        id: `demo-eval-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        simulation_id: input.simulation_id,
        user_id: input.user_id ?? null,
        message_id: input.message_id,
        rating: Math.min(5, Math.max(1, input.rating)),
        tags: input.tags ?? [],
        comment: input.comment ?? null,
        created_at: new Date().toISOString(),
      };
      demoEvaluations.push(newEvaluation);
      trimDemoArray(demoEvaluations);
      logger.info('Created demo simulation evaluation', { id: newEvaluation.id, simulation_id: newEvaluation.simulation_id });
      return newEvaluation;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_evaluations')
        .insert({
          simulation_id: input.simulation_id,
          user_id: input.user_id ?? null,
          message_id: input.message_id,
          rating: Math.min(5, Math.max(1, input.rating)),
          tags: input.tags ?? [],
          comment: input.comment ?? null,
        })
        .select()
        .single();

      if (error) throw new RepositoryError('create simulation evaluation', error.message, error.code);
      logger.info('Created simulation evaluation', { id: data.id, simulation_id: data.simulation_id });
      return this.mapRow(data);
    } catch (error) {
      logger.errorWithException('Failed to create simulation evaluation', error, {
        simulation_id: input.simulation_id,
        message_id: input.message_id,
        rating: input.rating,
      });
      throw error;
    }
  }

  /**
   * List evaluations by simulation ID
   */
  async listBySimulation(simulationId: string, filters?: { limit?: number; message_id?: string }): Promise<SimulationEvaluation[]> {
    if (isDemoMode()) {
      let results = demoEvaluations.filter(e => e.simulation_id === simulationId);
      if (filters?.message_id) {
        results = results.filter(e => e.message_id === filters.message_id);
      }
      return results.slice(0, filters?.limit ?? 100);
    }

    try {
      let query = this.client
        .from('simulation_evaluations')
        .select('*')
        .eq('simulation_id', simulationId)
        .order('created_at', { ascending: false });

      if (filters?.message_id) {
        query = query.eq('message_id', filters.message_id);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;
      if (error) throw new RepositoryError('list simulation evaluations', error.message, error.code);

      logger.debug('Listed simulation evaluations', { simulationId, count: data?.length ?? 0, filters });
      return (data ?? []).map(row => this.mapRow(row as SimulationEvaluationRow));
    } catch (error) {
      logger.errorWithException('Failed to list simulation evaluations', error, {
        simulationId,
        filters,
      });
      throw error;
    }
  }

  /**
   * Get aggregated rating for a simulation.
   * Optimized: fetches only the rating column (not all columns) in a single query.
   */
  async getAggregatedRating(simulationId: string): Promise<{ avg_rating: number | null; count: number }> {
    if (isDemoMode()) {
      const evaluations = demoEvaluations.filter(e => e.simulation_id === simulationId);
      if (evaluations.length === 0) {
        return { avg_rating: null, count: 0 };
      }
      const sum = evaluations.reduce((acc, e) => acc + e.rating, 0);
      return {
        avg_rating: Math.round((sum / evaluations.length) * 100) / 100,
        count: evaluations.length,
      };
    }

    try {
      // Single query: select only rating column (avoids fetching unnecessary data)
      const { data, error } = await this.client
        .from('simulation_evaluations')
        .select('rating')
        .eq('simulation_id', simulationId);

      if (error) throw new RepositoryError('get aggregated rating', error.message, error.code);

      const evaluations = data ?? [];
      if (evaluations.length === 0) {
        return { avg_rating: null, count: 0 };
      }

      const sum = evaluations.reduce((acc, e) => acc + (e.rating as number), 0);
      return {
        avg_rating: Math.round((sum / evaluations.length) * 100) / 100,
        count: evaluations.length,
      };
    } catch (error) {
      logger.errorWithException('Failed to get aggregated rating', error, { simulationId });
      throw error;
    }
  }

  /**
   * Update an existing evaluation
   */
  async update(id: string, input: UpdateSimulationEvaluationInput): Promise<SimulationEvaluation> {
    if (isDemoMode()) {
      const evaluation = demoEvaluations.find(e => e.id === id);
      if (!evaluation) {
        throw new RepositoryError('update simulation evaluation', 'Evaluation not found');
      }
      if (input.rating !== undefined) {
        evaluation.rating = Math.min(5, Math.max(1, input.rating));
      }
      if (input.tags !== undefined) {
        evaluation.tags = input.tags;
      }
      if (input.comment !== undefined) {
        evaluation.comment = input.comment;
      }
      logger.info('Updated demo simulation evaluation', { id });
      return evaluation;
    }

    try {
      const updates: Record<string, unknown> = {};
      if (input.rating !== undefined) {
        updates.rating = Math.min(5, Math.max(1, input.rating));
      }
      if (input.tags !== undefined) {
        updates.tags = input.tags;
      }
      if (input.comment !== undefined) {
        updates.comment = input.comment;
      }

      if (Object.keys(updates).length === 0) {
        const existing = await this.getById(id);
        if (!existing) throw new RepositoryError('update simulation evaluation', 'Evaluation not found');
        return existing;
      }

      const { data, error } = await this.client
        .from('simulation_evaluations')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new RepositoryError('update simulation evaluation', error.message, error.code);
      logger.info('Updated simulation evaluation', { id, updates });
      return this.mapRow(data);
    } catch (error) {
      logger.errorWithException('Failed to update simulation evaluation', error, {
        id,
        updates: input,
      });
      throw error;
    }
  }

  /**
   * Get evaluation by ID
   */
  async getById(id: string): Promise<SimulationEvaluation | null> {
    if (isDemoMode()) {
      return demoEvaluations.find(e => e.id === id) ?? null;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_evaluations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new RepositoryError('get simulation evaluation', error.message, error.code);
      if (!data) return null;
      return this.mapRow(data as SimulationEvaluationRow);
    } catch (error) {
      logger.errorWithException('Failed to get simulation evaluation', error, { id });
      throw error;
    }
  }

  /**
   * Delete an evaluation
   */
  async delete(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = demoEvaluations.findIndex(e => e.id === id);
      if (index !== -1) {
        demoEvaluations.splice(index, 1);
      }
      logger.info('Deleted demo simulation evaluation', { id });
      return;
    }

    try {
      const { error } = await this.client
        .from('simulation_evaluations')
        .delete()
        .eq('id', id);

      if (error) throw new RepositoryError('delete simulation evaluation', error.message, error.code);
      logger.info('Deleted simulation evaluation', { id });
    } catch (error) {
      logger.errorWithException('Failed to delete simulation evaluation', error, { id });
      throw error;
    }
  }

  /**
   * Map database row to SimulationEvaluation interface
   */
  private mapRow(row: SimulationEvaluationRow): SimulationEvaluation {
    return {
      id: row.id,
      simulation_id: row.simulation_id,
      user_id: row.user_id ?? null,
      message_id: row.message_id,
      rating: row.rating,
      tags: Array.isArray(row.tags) ? row.tags : [],
      comment: row.comment ?? null,
      created_at: row.created_at,
    };
  }
}

// Export singleton instance
export const simulationEvaluationRepository = new SimulationEvaluationRepository();
