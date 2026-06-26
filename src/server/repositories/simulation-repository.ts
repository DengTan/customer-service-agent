import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import type { SimulationConversation, SimulationMessage } from '@/lib/types';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { logger } from '@/lib/logger';
const simulationRepoLogger = logger.database;

const CONVERSATION_SELECT = 'id, title, scenario_id, scenario_name, status, message_count, created_by, created_at, updated_at';
const MESSAGE_SELECT = 'id, conversation_id, role, content, sources, confidence, confidence_breakdown, tool_calls, tool_results, image_url, message_type, rich_content, created_at';

// Demo mode in-memory storage
const demoConversations: SimulationConversation[] = [];
const demoMessages: Map<string, SimulationMessage[]> = new Map();

export interface CreateSimulationInput {
  id: string;
  title: string;
  scenario_id?: string | null;
  scenario_name: string;
  created_by: string;
}

export interface CreateSimulationMessageInput {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: unknown;
  confidence?: number | null;
  confidence_breakdown?: unknown;
  tool_calls?: unknown;
  tool_results?: unknown;
  image_url?: string | null;
  message_type?: string;
  rich_content?: unknown;
}

export class SimulationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async list(userId?: string, limit?: number, offset?: number): Promise<SimulationConversation[]> {
    if (isDemoMode()) {
      let result = [...demoConversations].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      if (userId) {
        result = result.filter(c => c.created_by === userId);
      }
      if (offset !== undefined && limit !== undefined) {
        return result.slice(offset, offset + limit);
      }
      return result;
    }

    try {
      let query = this.client
        .from('simulation_conversations')
        .select(CONVERSATION_SELECT)
        .order('created_at', { ascending: false });

      if (userId) {
        query = query.eq('created_by', userId);
      }

      if (offset !== undefined && limit !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }

      const { data, error } = await query;

      if (error) throw new RepositoryError('list simulations', error.message, error.code);
      return (data ?? []) as SimulationConversation[];
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Database query failed', { error: err });
      return [];
    }
  }

  async getById(id: string): Promise<SimulationConversation | null> {
    if (isDemoMode()) {
      return demoConversations.find(c => c.id === id) ?? null;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_conversations')
        .select(CONVERSATION_SELECT)
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw new RepositoryError('get simulation', error.message, error.code);
      }
      return data as SimulationConversation;
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Database query failed', { error: err });
      return null;
    }
  }

  async create(input: CreateSimulationInput): Promise<SimulationConversation> {
    const now = new Date().toISOString();
    const newConversation: SimulationConversation = {
      id: input.id,
      title: input.title,
      scenario_id: input.scenario_id ?? null,
      scenario_name: input.scenario_name,
      status: 'active',
      message_count: 0,
      created_by: input.created_by,
      created_at: now,
      updated_at: now,
    };

    if (isDemoMode()) {
      demoConversations.unshift(newConversation);
      trimDemoArray(demoConversations);
      return newConversation;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_conversations')
        .insert({
          id: newConversation.id,
          title: newConversation.title,
          scenario_id: newConversation.scenario_id,
          scenario_name: newConversation.scenario_name,
          status: newConversation.status,
          message_count: newConversation.message_count,
          created_by: newConversation.created_by,
          created_at: newConversation.created_at,
          updated_at: newConversation.updated_at,
        })
        .select(CONVERSATION_SELECT)
        .single();

      if (error) throw new RepositoryError('create simulation', error.message, error.code);
      return data as SimulationConversation;
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Database insert failed', { error: err });
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (isDemoMode()) {
      const index = demoConversations.findIndex(c => c.id === id);
      if (index !== -1) {
        demoConversations.splice(index, 1);
        demoMessages.delete(id);
        return true;
      }
      return false;
    }

    try {
      const { error } = await this.client
        .from('simulation_conversations')
        .delete()
        .eq('id', id);

      if (error) throw new RepositoryError('delete simulation', error.message, error.code);
      return true;
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Database delete failed', { error: err });
      return false;
    }
  }

  async listMessages(conversationId: string): Promise<SimulationMessage[]> {
    if (isDemoMode()) {
      return demoMessages.get(conversationId) ?? [];
    }

    try {
      const { data, error } = await this.client
        .from('simulation_messages')
        .select(MESSAGE_SELECT)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw new RepositoryError('list messages', error.message, error.code);
      return (data ?? []) as SimulationMessage[];
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Database query failed', { error: err });
      return [];
    }
  }

  async createMessage(input: CreateSimulationMessageInput): Promise<SimulationMessage> {
    const now = new Date().toISOString();
    const newMessage: SimulationMessage = {
      id: input.id,
      conversation_id: input.conversation_id,
      role: input.role,
      content: input.content,
      sources: (input.sources as SimulationMessage['sources']) ?? null,
      confidence: input.confidence ?? null,
      confidence_breakdown: (input.confidence_breakdown as SimulationMessage['confidence_breakdown']) ?? null,
      tool_calls: input.tool_calls ?? null,
      tool_results: input.tool_results ?? null,
      image_url: input.image_url ?? null,
      message_type: (input.message_type as SimulationMessage['message_type']) ?? 'text',
      rich_content: input.rich_content ?? null,
      created_at: now,
    };

    if (isDemoMode()) {
      const messages = demoMessages.get(input.conversation_id) ?? [];
      messages.push(newMessage);
      demoMessages.set(input.conversation_id, messages);
      
      // Update conversation message count
      const conv = demoConversations.find(c => c.id === input.conversation_id);
      if (conv) {
        conv.message_count = messages.length;
        conv.updated_at = now;
      }
      return newMessage;
    }

    try {
      const { data, error } = await this.client
        .from('simulation_messages')
        .insert({
          id: newMessage.id,
          conversation_id: newMessage.conversation_id,
          role: newMessage.role,
          content: newMessage.content,
          sources: newMessage.sources,
          confidence: newMessage.confidence,
          confidence_breakdown: newMessage.confidence_breakdown,
          tool_calls: newMessage.tool_calls,
          tool_results: newMessage.tool_results,
          image_url: newMessage.image_url,
          message_type: newMessage.message_type,
          rich_content: newMessage.rich_content,
          created_at: newMessage.created_at,
        })
        .select(MESSAGE_SELECT)
        .single();

      if (error) throw new RepositoryError('create message', error.message, error.code);

      // Update conversation message count (fire-and-forget)
      // Using async IIFE to avoid blocking the return statement
      (async () => {
        try {
          await this.client.rpc('increment_simulation_message_count', {
            conv_id: input.conversation_id,
          });
        } catch {
          // Ignore RPC errors, count will be updated on next query
        }
      })();

      return data as SimulationMessage;
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Database insert failed', { error: err });
      throw err;
    }
  }

  async count(userId?: string): Promise<number> {
    if (isDemoMode()) {
      let result = demoConversations;
      if (userId) {
        result = result.filter(c => c.created_by === userId);
      }
      return result.length;
    }

    try {
      let query = this.client
        .from('simulation_conversations')
        .select('id', { count: 'exact', head: true });

      if (userId) {
        query = query.eq('created_by', userId);
      }

      const { count, error } = await query;
      if (error) throw new RepositoryError('count simulations', error.message, error.code);
      return count ?? 0;
    } catch (err) {
      simulationRepoLogger.error('[SimulationRepository] Count query failed', { error: err });
      return 0;
    }
  }
}

// Export singleton instance
export const simulationRepository = new SimulationRepository();
