import { getSupabaseClient } from '@/storage/database/supabase-client';

const supabase = getSupabaseClient();

/** Check if error is PostgREST schema cache miss (PGRST205) */
function isSchemaCacheMiss(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST205' || (error.message?.includes('schema cache') ?? false);
}

export type TicketRelationType = 'blocks' | 'related' | 'duplicates';

export interface TicketRelationRecord {
  id: string;
  source_ticket_id: string;
  target_ticket_id: string;
  relation_type: TicketRelationType;
  created_at: string;
  // Joined
  target_ticket?: { id: string; ticket_number: string; title: string; status: string; priority: string };
  source_ticket?: { id: string; ticket_number: string; title: string; status: string; priority: string };
}

export interface ChildTicketSummary {
  id: string;
  ticket_number: string;
  title: string;
  status: string;
  priority: string;
}

const VALID_RELATION_TYPES: TicketRelationType[] = ['blocks', 'related', 'duplicates'];

export async function addRelation(sourceTicketId: string, targetTicketId: string, relationType: TicketRelationType): Promise<TicketRelationRecord> {
  if (sourceTicketId === targetTicketId) {
    throw new Error('Cannot relate a ticket to itself');
  }
  
  // Validate relation type
  if (!VALID_RELATION_TYPES.includes(relationType)) {
    throw new Error(`Invalid relation type: ${relationType}. Must be one of: ${VALID_RELATION_TYPES.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('ticket_relations')
    .insert({
      source_ticket_id: sourceTicketId,
      target_ticket_id: targetTicketId,
      relation_type: relationType,
    })
    .select('*, target_ticket:tickets!ticket_relations_target_ticket_id_fkey(id, ticket_number, title, status, priority)')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('关联关系已存在');
    }
    throw error;
  }
  return data;
}

export async function removeRelation(relationId: string): Promise<void> {
  const { error } = await supabase
    .from('ticket_relations')
    .delete()
    .eq('id', relationId);

  if (error) throw error;
}

export async function getRelations(ticketId: string): Promise<TicketRelationRecord[]> {
  // Get relations where this ticket is the source or target
  const [outgoing, incoming] = await Promise.all([
    supabase
      .from('ticket_relations')
      .select('*, target_ticket:tickets!ticket_relations_target_ticket_id_fkey(id, ticket_number, title, status, priority)')
      .eq('source_ticket_id', ticketId),
    supabase
      .from('ticket_relations')
      .select('*, source_ticket:tickets!ticket_relations_source_ticket_id_fkey(id, ticket_number, title, status, priority)')
      .eq('target_ticket_id', ticketId),
  ]);

  if (outgoing.error) {
    if (isSchemaCacheMiss(outgoing.error)) return [];
    throw outgoing.error;
  }
  if (incoming.error) {
    if (isSchemaCacheMiss(incoming.error)) return [];
    throw incoming.error;
  }

  // Normalize incoming relations to look like outgoing
  const normalizedIncoming = (incoming.data || []).map((r: Record<string, unknown>) => ({
    id: r.id,
    source_ticket_id: r.source_ticket_id,
    target_ticket_id: r.target_ticket_id,
    relation_type: r.relation_type === 'blocks' ? 'blocked_by' : r.relation_type === 'duplicates' ? 'duplicated_by' : 'related',
    created_at: r.created_at,
    target_ticket: r.source_ticket, // Flip: for incoming, the "other" ticket is the source
  }));

  return [...(outgoing.data || []), ...normalizedIncoming];
}

export async function getChildTickets(parentTicketId: string): Promise<ChildTicketSummary[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, title, status, priority')
    .eq('parent_ticket_id', parentTicketId)
    .order('created_at', { ascending: true });

  if (error) {
    // parent_ticket_id column may not be in schema cache yet
    if (isSchemaCacheMiss(error) || error.message?.includes('parent_ticket_id')) return [];
    throw error;
  }
  return (data as unknown as ChildTicketSummary[]) || [];
}

/**
 * Check if setting parentTicketId as parent of ticketId would create a circular reference.
 * Returns true if a cycle would be created.
 */
async function wouldCreateCycle(ticketId: string, parentTicketId: string): Promise<boolean> {
  let currentId: string | null = parentTicketId;
  const visited = new Set<string>();
  
  while (currentId) {
    if (currentId === ticketId) {
      return true; // Found the ticket we're trying to set as parent - cycle detected
    }
    if (visited.has(currentId)) {
      return true; // Already visited - should not happen but safety check
    }
    visited.add(currentId);
    
    // Get the parent of current node
    const { data }: { data: { parent_ticket_id: string | null } | null } = await supabase
      .from('tickets')
      .select('parent_ticket_id')
      .eq('id', currentId)
      .single();
    
    currentId = data?.parent_ticket_id || null;
  }
  
  return false;
}

export async function setParentTicket(ticketId: string, parentTicketId: string | null): Promise<void> {
  // Validate: cannot set self as parent
  if (parentTicketId === ticketId) {
    throw new Error('Cannot set a ticket as its own parent');
  }
  
  if (parentTicketId) {
    // Check for circular reference
    const hasCycle = await wouldCreateCycle(ticketId, parentTicketId);
    if (hasCycle) {
      throw new Error('Setting this parent would create a circular reference');
    }
  }
  
  const { error } = await supabase
    .from('tickets')
    .update({ parent_ticket_id: parentTicketId })
    .eq('id', ticketId);

  if (error) throw error;
}

export async function getChildTicketProgress(parentTicketId: string): Promise<{ total: number; closed: number; resolved: number; in_progress: number }> {
  const { data, error } = await supabase
    .from('tickets')
    .select('status')
    .eq('parent_ticket_id', parentTicketId);

  if (error) throw error;

  const tickets = data || [];
  return {
    total: tickets.length,
    closed: tickets.filter(t => t.status === 'closed').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
  };
}
