import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, isDemoMode } from '@/storage/database/supabase-client';
import { RepositoryError } from './repository-error';
import { DEMO_ARRAY_MAX_SIZE } from '@/lib/constants';
import { logger } from '@/lib/logger';

// ===== Types =====

export interface SensitiveWordRow {
  id: string;
  word: string;
  match_mode: 'exact' | 'fuzzy';
  action: 'block' | 'replace' | 'warn';
  replacement?: string | null;
  category?: string | null;
  is_enabled: boolean;
  hit_count: number;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface AllowedDomainRow {
  id: string;
  domain: string;
  pattern_type: 'exact' | 'wildcard' | 'suffix';
  description?: string | null;
  is_enabled: boolean;
  hit_count: number;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface FilterLogRow {
  id: string;
  conversation_id?: string | null;
  message_id?: string | null;
  filter_type: string;
  word?: string | null;
  action: string;
  original_content: string;
  filtered_content?: string | null;
  created_at: string;
}

// ===== Demo Data =====

const demoSensitiveWords: SensitiveWordRow[] = [
  {
    id: 'demo-sword-1',
    word: '傻逼',
    match_mode: 'exact',
    action: 'block',
    category: '脏话',
    is_enabled: true,
    hit_count: 5,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-sword-2',
    word: 'fuck',
    match_mode: 'exact',
    action: 'replace',
    replacement: '****',
    category: '脏话',
    is_enabled: true,
    hit_count: 3,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-sword-3',
    word: '骗子',
    match_mode: 'fuzzy',
    action: 'warn',
    category: '其他',
    is_enabled: true,
    hit_count: 1,
    created_at: new Date().toISOString(),
  },
];

const demoAllowedDomains: AllowedDomainRow[] = [
  {
    id: 'demo-domain-1',
    domain: '*.shop.example.com',
    pattern_type: 'wildcard',
    description: '官方商城',
    is_enabled: true,
    hit_count: 12,
    created_at: new Date().toISOString(),
  },
  {
    id: 'demo-domain-2',
    domain: 'cdn.example.com',
    pattern_type: 'suffix',
    description: 'CDN 域名',
    is_enabled: true,
    hit_count: 8,
    created_at: new Date().toISOString(),
  },
];

const demoFilterLogs: FilterLogRow[] = [];

// ===== Repository =====

export interface CreateSensitiveWordInput {
  word: string;
  match_mode?: 'exact' | 'fuzzy';
  action?: 'block' | 'replace' | 'warn';
  replacement?: string;
  category?: string;
  is_enabled?: boolean;
  created_by?: string;
}

export interface UpdateSensitiveWordInput {
  word?: string;
  match_mode?: 'exact' | 'fuzzy';
  action?: 'block' | 'replace' | 'warn';
  replacement?: string;
  category?: string;
  is_enabled?: boolean;
}

export interface CreateDomainInput {
  domain: string;
  pattern_type?: 'exact' | 'wildcard' | 'suffix';
  description?: string;
  is_enabled?: boolean;
  created_by?: string;
}

export interface UpdateDomainInput {
  domain?: string;
  pattern_type?: 'exact' | 'wildcard' | 'suffix';
  description?: string;
  is_enabled?: boolean;
}

export interface CreateFilterLogInput {
  conversation_id?: string;
  message_id?: string;
  filter_type: 'sensitive_word' | 'url';
  word?: string;
  action: 'blocked' | 'replaced' | 'warned';
  original_content: string;
  filtered_content?: string;
}

export class ContentFilterRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  // ===== Sensitive Words CRUD =====

  async listSensitiveWords(filters?: {
    category?: string;
    is_enabled?: boolean;
  }): Promise<SensitiveWordRow[]> {
    if (isDemoMode()) {
      let result = [...demoSensitiveWords];
      if (filters?.category) {
        result = result.filter((w) => w.category === filters.category);
      }
      if (filters?.is_enabled !== undefined) {
        result = result.filter((w) => w.is_enabled === filters.is_enabled);
      }
      return result;
    }

    let query = this.client.from('content_sensitive_words').select('*');
    if (filters?.category) {
      query = query.eq('category', filters.category);
    }
    if (filters?.is_enabled !== undefined) {
      query = query.eq('is_enabled', filters.is_enabled);
    }
    const { data, error } = await query.order('hit_count', { ascending: false });

    if (error) throw new RepositoryError('list sensitive words', error.message, error.code);
    return (data ?? []) as SensitiveWordRow[];
  }

  async createSensitiveWord(input: CreateSensitiveWordInput): Promise<SensitiveWordRow> {
    if (isDemoMode()) {
      const newWord: SensitiveWordRow = {
        id: `demo-sword-${Date.now()}`,
        word: input.word,
        match_mode: input.match_mode ?? 'exact',
        action: input.action ?? 'block',
        replacement: input.replacement ?? null,
        category: input.category ?? '脏话',
        is_enabled: input.is_enabled ?? true,
        hit_count: 0,
        created_by: input.created_by ?? null,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      demoSensitiveWords.push(newWord);
      if (demoSensitiveWords.length > DEMO_ARRAY_MAX_SIZE) {
        demoSensitiveWords.splice(0, demoSensitiveWords.length - DEMO_ARRAY_MAX_SIZE);
      }
      return newWord;
    }

    const { data, error } = await this.client
      .from('content_sensitive_words')
      .insert({
        word: input.word,
        match_mode: input.match_mode ?? 'exact',
        action: input.action ?? 'block',
        replacement: input.replacement ?? null,
        category: input.category ?? '脏话',
        is_enabled: input.is_enabled ?? true,
        created_by: input.created_by ?? null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create sensitive word', error.message, error.code);
    return data as SensitiveWordRow;
  }

  async updateSensitiveWord(id: string, updates: UpdateSensitiveWordInput): Promise<SensitiveWordRow> {
    if (isDemoMode()) {
      const word = demoSensitiveWords.find((w) => w.id === id);
      if (!word) throw new RepositoryError('update sensitive word', 'Not found', 'NOT_FOUND');
      Object.assign(word, updates, { updated_at: new Date().toISOString() });
      return word;
    }

    const { data, error } = await this.client
      .from('content_sensitive_words')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update sensitive word', error.message, error.code);
    return data as SensitiveWordRow;
  }

  async deleteSensitiveWord(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = demoSensitiveWords.findIndex((w) => w.id === id);
      if (index !== -1) demoSensitiveWords.splice(index, 1);
      return;
    }

    const { error } = await this.client.from('content_sensitive_words').delete().eq('id', id);
    if (error) throw new RepositoryError('delete sensitive word', error.message, error.code);
  }

  async incrementHitCount(word: string): Promise<void> {
    if (isDemoMode()) {
      const found = demoSensitiveWords.find((w) => w.word === word);
      if (found) found.hit_count++;
      return;
    }

    try {
      const { error } = await this.client.rpc('increment_hit_count', {
        table_name: 'content_sensitive_words',
        row_word: word,
      });
      if (error) throw error;
    } catch {
      // Fallback: direct SQL update using a subquery to get current value
      const { error: updateError } = await this.client
        .from('content_sensitive_words')
        .update({ hit_count: this.client.rpc('get_hit_count', { target_table: 'content_sensitive_words', target_word: word }) })
        .eq('word', word);
      if (updateError) {
        logger.api.warn('Failed to increment sensitive word hit count', { word, error: updateError });
      }
    }
  }

  // ===== Allowed Domains CRUD =====

  async listAllowedDomains(filters?: {
    is_enabled?: boolean;
  }): Promise<AllowedDomainRow[]> {
    if (isDemoMode()) {
      let result = [...demoAllowedDomains];
      if (filters?.is_enabled !== undefined) {
        result = result.filter((d) => d.is_enabled === filters.is_enabled);
      }
      return result;
    }

    let query = this.client.from('allowed_domains').select('*');
    if (filters?.is_enabled !== undefined) {
      query = query.eq('is_enabled', filters.is_enabled);
    }
    const { data, error } = await query.order('hit_count', { ascending: false });

    if (error) throw new RepositoryError('list allowed domains', error.message, error.code);
    return (data ?? []) as AllowedDomainRow[];
  }

  async createAllowedDomain(input: CreateDomainInput): Promise<AllowedDomainRow> {
    if (isDemoMode()) {
      const newDomain: AllowedDomainRow = {
        id: `demo-domain-${Date.now()}`,
        domain: input.domain,
        pattern_type: input.pattern_type ?? 'exact',
        description: input.description ?? null,
        is_enabled: input.is_enabled ?? true,
        hit_count: 0,
        created_by: input.created_by ?? null,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      demoAllowedDomains.push(newDomain);
      if (demoAllowedDomains.length > DEMO_ARRAY_MAX_SIZE) {
        demoAllowedDomains.splice(0, demoAllowedDomains.length - DEMO_ARRAY_MAX_SIZE);
      }
      return newDomain;
    }

    const { data, error } = await this.client
      .from('allowed_domains')
      .insert({
        domain: input.domain,
        pattern_type: input.pattern_type ?? 'exact',
        description: input.description ?? null,
        is_enabled: input.is_enabled ?? true,
        created_by: input.created_by ?? null,
      })
      .select()
      .single();

    if (error) throw new RepositoryError('create allowed domain', error.message, error.code);
    return data as AllowedDomainRow;
  }

  async updateAllowedDomain(id: string, updates: UpdateDomainInput): Promise<AllowedDomainRow> {
    if (isDemoMode()) {
      const domain = demoAllowedDomains.find((d) => d.id === id);
      if (!domain) throw new RepositoryError('update allowed domain', 'Not found', 'NOT_FOUND');
      Object.assign(domain, updates, { updated_at: new Date().toISOString() });
      return domain;
    }

    const { data, error } = await this.client
      .from('allowed_domains')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new RepositoryError('update allowed domain', error.message, error.code);
    return data as AllowedDomainRow;
  }

  async deleteAllowedDomain(id: string): Promise<void> {
    if (isDemoMode()) {
      const index = demoAllowedDomains.findIndex((d) => d.id === id);
      if (index !== -1) demoAllowedDomains.splice(index, 1);
      return;
    }

    const { error } = await this.client.from('allowed_domains').delete().eq('id', id);
    if (error) throw new RepositoryError('delete allowed domain', error.message, error.code);
  }

  async incrementDomainHitCount(domain: string): Promise<void> {
    if (isDemoMode()) {
      const found = demoAllowedDomains.find((d) => d.domain === domain);
      if (found) found.hit_count++;
      return;
    }

    const { error } = await this.client.rpc('increment_domain_hit_count', {
      row_domain: domain,
    });
    if (error) {
      // Fallback: manual increment via query
      const { error: updateError } = await this.client
        .from('allowed_domains')
        .update({ hit_count: this.client.rpc('hit_count', { word: domain }) })
        .eq('domain', domain);
      if (updateError)
        throw new RepositoryError('increment domain hit count', updateError.message, updateError.code);
    }
  }

  // ===== Filter Logs =====

  async createFilterLog(log: CreateFilterLogInput): Promise<void> {
    if (isDemoMode()) {
      demoFilterLogs.push({
        id: `demo-log-${Date.now()}`,
        conversation_id: log.conversation_id ?? null,
        message_id: log.message_id ?? null,
        filter_type: log.filter_type,
        word: log.word ?? null,
        action: log.action,
        original_content: log.original_content,
        filtered_content: log.filtered_content ?? null,
        created_at: new Date().toISOString(),
      });
      if (demoFilterLogs.length > DEMO_ARRAY_MAX_SIZE) {
        demoFilterLogs.splice(0, demoFilterLogs.length - DEMO_ARRAY_MAX_SIZE);
      }
      return;
    }

    const { error } = await this.client.from('content_filter_logs').insert({
      conversation_id: log.conversation_id ?? null,
      message_id: log.message_id ?? null,
      filter_type: log.filter_type,
      word: log.word ?? null,
      action: log.action,
      original_content: log.original_content,
      filtered_content: log.filtered_content ?? null,
    });

    if (error) throw new RepositoryError('create filter log', error.message, error.code);
  }

  async listFilterLogs(filters?: {
    conversation_id?: string;
    filter_type?: string;
    limit?: number;
    offset?: number;
  }): Promise<FilterLogRow[]> {
    if (isDemoMode()) {
      let result = [...demoFilterLogs].reverse();
      if (filters?.conversation_id) {
        result = result.filter((l) => l.conversation_id === filters.conversation_id);
      }
      if (filters?.filter_type) {
        result = result.filter((l) => l.filter_type === filters.filter_type);
      }
      const offset = filters?.offset ?? 0;
      const limit = filters?.limit ?? 50;
      result = result.slice(offset, offset + limit);
      return result;
    }

    let query = this.client.from('content_filter_logs').select('*');
    if (filters?.conversation_id) {
      query = query.eq('conversation_id', filters.conversation_id);
    }
    if (filters?.filter_type) {
      query = query.eq('filter_type', filters.filter_type);
    }
    query = query.order('created_at', { ascending: false });
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit ?? 50) - 1);
    } else if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    const { data, error } = await query;

    if (error) throw new RepositoryError('list filter logs', error.message, error.code);
    return (data ?? []) as FilterLogRow[];
  }

  // ===== Statistics =====

  async getSensitiveWordStats(): Promise<{ total: number; categories: Record<string, number> }> {
    if (isDemoMode()) {
      const categories: Record<string, number> = {};
      demoSensitiveWords.forEach((w) => {
        const cat = w.category ?? '其他';
        categories[cat] = (categories[cat] ?? 0) + 1;
      });
      return { total: demoSensitiveWords.length, categories };
    }

    const { data, error } = await this.client
      .from('content_sensitive_words')
      .select('category');
    if (error) throw new RepositoryError('get sensitive word stats', error.message, error.code);

    const categories: Record<string, number> = {};
    (data ?? []).forEach((row: { category?: string | null }) => {
      const cat = row.category ?? '其他';
      categories[cat] = (categories[cat] ?? 0) + 1;
    });
    return { total: (data ?? []).length, categories };
  }

  async getDomainStats(): Promise<{ total: number; enabled: number }> {
    if (isDemoMode()) {
      return {
        total: demoAllowedDomains.length,
        enabled: demoAllowedDomains.filter((d) => d.is_enabled).length,
      };
    }

    const [allResult, enabledResult] = await Promise.all([
      this.client.from('allowed_domains').select('id', { count: 'exact', head: true }),
      this.client.from('allowed_domains').select('id', { count: 'exact', head: true }).eq('is_enabled', true),
    ]);

    if (allResult.error) throw new RepositoryError('get domain stats', allResult.error.message, allResult.error.code);
    return {
      total: allResult.count ?? 0,
      enabled: enabledResult.count ?? 0,
    };
  }
}
