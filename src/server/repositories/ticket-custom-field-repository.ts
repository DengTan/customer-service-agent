import { getSupabaseClient } from '@/storage/database/supabase-client';

const supabase = getSupabaseClient();

export interface TicketCategoryRecord {
  id: string;
  name: string;
  color: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface TicketCustomFieldRecord {
  id: string;
  name: string;
  field_key: string;
  field_type: 'text' | 'number' | 'select' | 'date';
  options: string[] | null;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface TicketFieldValueRecord {
  id: string;
  ticket_id: string;
  field_id: string;
  field_value: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  field?: TicketCustomFieldRecord;
}

/** Check if error is PostgREST schema cache miss (PGRST205) - table not yet in cache */
function isSchemaCacheMiss(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST205' || (error.message?.includes('schema cache') ?? false);
}

// ============ Categories ============

export async function getCategories(): Promise<TicketCategoryRecord[]> {
  const { data, error } = await supabase
    .from('ticket_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    if (isSchemaCacheMiss(error)) return [];
    throw error;
  }
  return data || [];
}

export async function createCategory(input: Omit<TicketCategoryRecord, 'id' | 'created_at'>): Promise<TicketCategoryRecord> {
  const { data, error } = await supabase
    .from('ticket_categories')
    .insert(input)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCategory(id: string, input: Partial<TicketCategoryRecord>): Promise<TicketCategoryRecord> {
  const { data, error } = await supabase
    .from('ticket_categories')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from('ticket_categories')
    .update({ is_active: false })
    .eq('id', id);

  if (error) throw error;
}

// ============ Custom Fields ============

export async function getCustomFields(): Promise<TicketCustomFieldRecord[]> {
  const { data, error } = await supabase
    .from('ticket_custom_fields')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    if (isSchemaCacheMiss(error)) return [];
    throw error;
  }
  return data || [];
}

export async function createCustomField(input: Omit<TicketCustomFieldRecord, 'id' | 'created_at'>): Promise<TicketCustomFieldRecord> {
  const { data, error } = await supabase
    .from('ticket_custom_fields')
    .insert(input)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCustomField(id: string, input: Partial<TicketCustomFieldRecord>): Promise<TicketCustomFieldRecord> {
  const { data, error } = await supabase
    .from('ticket_custom_fields')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCustomField(id: string): Promise<void> {
  const { error } = await supabase
    .from('ticket_custom_fields')
    .update({ is_active: false })
    .eq('id', id);

  if (error) throw error;
}

// ============ Field Values ============

export async function getFieldValues(ticketId: string): Promise<TicketFieldValueRecord[]> {
  const { data, error } = await supabase
    .from('ticket_field_values')
    .select('*, field:ticket_custom_fields(*)')
    .eq('ticket_id', ticketId);

  if (error) {
    if (isSchemaCacheMiss(error)) return [];
    throw error;
  }
  return data || [];
}

export async function upsertFieldValue(ticketId: string, fieldId: string, value: string): Promise<TicketFieldValueRecord> {
  const { data, error } = await supabase
    .from('ticket_field_values')
    .upsert(
      { ticket_id: ticketId, field_id: fieldId, field_value: value },
      { onConflict: 'ticket_id,field_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteFieldValue(ticketId: string, fieldId: string): Promise<void> {
  const { error } = await supabase
    .from('ticket_field_values')
    .delete()
    .eq('ticket_id', ticketId)
    .eq('field_id', fieldId);

  if (error) throw error;
}

export async function upsertFieldValues(ticketId: string, values: Array<{ field_id: string; field_value: string }>): Promise<void> {
  if (!values.length) return;
  const rows = values.map(v => ({
    ticket_id: ticketId,
    field_id: v.field_id,
    field_value: v.field_value,
  }));
  const { error } = await supabase
    .from('ticket_field_values')
    .upsert(rows, { onConflict: 'ticket_id,field_id' });

  if (error) {
    if (isSchemaCacheMiss(error)) return;
    throw error;
  }
}
