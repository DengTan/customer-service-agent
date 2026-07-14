import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { trimDemoArray } from '@/lib/api-utils';
import { DEMO_PUSH_TEMPLATES, DEMO_EVENT_LOGS } from './demo-data/demo-push';
import { logger } from '@/lib/logger';

export interface PushTemplate {
  id: string;
  name: string;
  trigger_event: string;
  content_template: string;
  channels: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CreatePushTemplateInput {
  name: string;
  trigger_event: string;
  content_template: string;
  channels?: string[];
  is_enabled?: boolean;
}

export interface UpdatePushTemplateInput {
  id: string;
  name?: string;
  trigger_event?: string;
  content_template?: string;
  channels?: string[];
  is_enabled?: boolean;
}

export interface PushRecord {
  id: string;
  template_id: string;
  recipient_id: string;
  content: string;
  trigger_event: string;
  channel: string;
  status: string;
  error_message?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
}

export interface PushRecordFilters {
  trigger_event?: string | null;
  status?: string | null;
  channel?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  limit?: number;
  offset?: number;
}

export interface PushRecordResult {
  records: PushRecord[];
  total: number | null;
}

export interface PushEventLog {
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  status: string;
  processed_at?: string;
  created_at: string;
}

export interface EventLogFilters {
  limit?: number;
}

export interface UpdateEventStatusInput {
  id: string;
  status: string;
}

export class PushRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // Demo 数据的可变本地副本（避免修改导入的常量）
  private _demoTemplates = [...(DEMO_PUSH_TEMPLATES as PushTemplate[])];
  private _demoEventLogs = [...(DEMO_EVENT_LOGS as PushEventLog[])];
  private readonly _demoWebhookSecret = 'demo-webhook-secret-' + Math.random().toString(36).substring(7);

  async listTemplates(): Promise<PushTemplate[]> {
    if (isDemoMode()) {
      return this._demoTemplates;
    }
    
    const { data, error } = await this.client
      .from('push_templates')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw new RepositoryError('list push templates', error.message, error.code);
    return (data ?? []) as PushTemplate[];
  }

  async createTemplate(input: CreatePushTemplateInput): Promise<PushTemplate> {
    if (isDemoMode()) {
      const newTemplate: PushTemplate = {
        id: `demo-template-${Date.now()}`,
        name: input.name,
        trigger_event: input.trigger_event,
        content_template: input.content_template,
        channels: input.channels ?? ['web'],
        is_enabled: input.is_enabled !== undefined ? input.is_enabled : true,
        created_at: new Date().toISOString(),
      };
      this._demoTemplates.push(newTemplate);
      trimDemoArray(this._demoTemplates);
      return newTemplate;
    }
    
    const { data, error } = await this.client
      .from('push_templates')
      .insert({
        name: input.name,
        trigger_event: input.trigger_event,
        content_template: input.content_template,
        channels: input.channels ?? ['web'],
        is_enabled: input.is_enabled !== undefined ? input.is_enabled : true,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create push template', error.message, error.code);
    return data as PushTemplate;
  }

  async updateTemplate(input: UpdatePushTemplateInput): Promise<PushTemplate> {
    if (isDemoMode()) {
      const template = this._demoTemplates.find(t => t.id === input.id);
      if (template) {
        if (input.name !== undefined) template.name = input.name;
        if (input.trigger_event !== undefined) template.trigger_event = input.trigger_event;
        if (input.content_template !== undefined) template.content_template = input.content_template;
        if (input.channels !== undefined) template.channels = input.channels;
        if (input.is_enabled !== undefined) template.is_enabled = input.is_enabled;
        template.updated_at = new Date().toISOString();
        return template;
      }
      throw new RepositoryError('update push template', 'Template not found');
    }
    
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.trigger_event !== undefined) updates.trigger_event = input.trigger_event;
    if (input.content_template !== undefined) updates.content_template = input.content_template;
    if (input.channels !== undefined) updates.channels = input.channels;
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;

    const { data, error } = await this.client
      .from('push_templates')
      .update(updates)
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update push template', error.message, error.code);
    return data as PushTemplate;
  }

  async deleteTemplate(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = this._demoTemplates.findIndex(t => t.id === id);
      if (index !== -1) {
        this._demoTemplates.splice(index, 1);
      }
      return;
    }
    
    const { error } = await this.client
      .from('push_templates')
      .delete()
      .eq('id', id);

    if (error) throw new RepositoryError('delete push template', error.message, error.code);
  }

  async listRecords(filters: PushRecordFilters): Promise<PushRecordResult> {
    if (isDemoMode()) {
      return { records: [], total: 0 };
    }
    
    try {
      let query = this.client
        .from('push_records')
        .select('*', { count: 'exact' })
        .order('sent_at', { ascending: false });

      if (filters.trigger_event) query = query.eq('trigger_event', filters.trigger_event);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.channel) query = query.eq('channel', filters.channel);
      if (filters.start_date) query = query.gte('sent_at', filters.start_date);
      if (filters.end_date) query = query.lte('sent_at', filters.end_date);

      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw new RepositoryError('list push records', error.message, error.code);
      return { records: (data ?? []) as PushRecord[], total: count };
    } catch (error) {
      logger.error('[PushRepository] Database query failed in listRecords, falling back to demo data', { error });
      return { records: [], total: 0 };
    }
  }

  async listEventLogs(filters: EventLogFilters): Promise<PushEventLog[]> {
    if (isDemoMode()) {
      return this._demoEventLogs;
    }
    
    try {
      const { data, error } = await this.client
        .from('push_event_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(filters.limit ?? 20);

      if (error) throw new RepositoryError('list push event logs', error.message, error.code);
      return (data ?? []) as PushEventLog[];
    } catch (error) {
      logger.error('[PushRepository] Database query failed in listEventLogs, falling back to demo data', { error });
      return this._demoEventLogs;
    }
  }

  async getWebhookSecret(): Promise<string> {
    if (isDemoMode()) {
      return this._demoWebhookSecret;
    }
    
    const { data } = await this.client
      .from('settings')
      .select('value')
      .eq('key', 'push_webhook_secret')
      .maybeSingle();

    return (data as { value: string } | null)?.value ?? 'default-secret';
  }

  async updateEventStatus(input: UpdateEventStatusInput): Promise<PushEventLog> {
    if (isDemoMode()) {
      const event = this._demoEventLogs.find(e => e.id === input.id);
      if (event) {
        event.status = input.status;
        event.processed_at = new Date().toISOString();
        return event;
      }
      throw new RepositoryError('update push event status', 'Event not found');
    }
    
    const { data, error } = await this.client
      .from('push_event_log')
      .update({ status: input.status })
      .eq('id', input.id)
      .select()
      .single();

    if (error) throw new RepositoryError('update push event status', error.message, error.code);
    return data as PushEventLog;
  }
}
