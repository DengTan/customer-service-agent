import { ContentFilterRepository } from '@/server/repositories/content-filter-repository';
import { SettingsRepository } from '@/server/repositories/settings-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { logger } from '@/lib/logger';

// ===== Types =====

export interface FilterResult {
  allowed: boolean;
  filteredContent: string;
  sensitiveWordMatches: SensitiveWordMatch[];
  urlMatches: UrlMatch[];
  warnings: string[];
}

export interface SensitiveWordMatch {
  word: string;
  position: number;
  length: number;
  match_mode: 'exact' | 'fuzzy';
  action: 'block' | 'replace' | 'warn';
  replacement?: string;
  category: string;
}

export interface UrlMatch {
  url: string;
  domain: string;
  isAllowed: boolean;
}

// URL regex patterns
const URL_REGEX = /https?:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+([\/\?&#].*)?/gi;
const DOMAIN_REGEX = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+/i;
const CACHE_TTL_MS = 30_000; // 30 seconds
const MAX_CACHE_SIZE = 10000; // Max entries in cache

// ===== Service =====

export class ContentFilterService {
  private readonly repository: ContentFilterRepository;
  private readonly settingsRepository: SettingsRepository;

  // In-memory cache for enabled sensitive words and domains
  private sensitiveWordsCache: {
    words: Array<{
      word: string;
      match_mode: 'exact' | 'fuzzy';
      action: 'block' | 'replace' | 'warn';
      replacement?: string;
      category: string;
    }>;
    timestamp: number;
  } | null = null;

  private domainsCache: {
    domains: Array<{
      domain: string;
      pattern_type: 'exact' | 'wildcard' | 'suffix';
    }>;
    timestamp: number;
  } | null = null;

  constructor(
    repository: ContentFilterRepository = new ContentFilterRepository(),
    settingsRepository: SettingsRepository = new SettingsRepository()
  ) {
    this.repository = repository;
    this.settingsRepository = settingsRepository;
  }

  /**
   * Main content filtering method
   * Checks sensitive words and URLs, returns FilterResult
   */
  async filterContent(
    content: string,
    options?: { conversationId?: string; logEnabled?: boolean }
  ): Promise<FilterResult> {
    const result: FilterResult = {
      allowed: true,
      filteredContent: content,
      sensitiveWordMatches: [],
      urlMatches: [],
      warnings: [],
    };

    try {
      // Check if content filter is enabled
      const contentFilterEnabled = (await this.settingsRepository.get('content_filter_enabled')) === 'true';
      if (!contentFilterEnabled) {
        return result;
      }

      // Check sensitive words
      const sensitiveWordEnabled = (await this.settingsRepository.get('sensitive_word_filter_enabled')) === 'true';
      if (sensitiveWordEnabled) {
        const wordMatches = await this.checkSensitiveWords(content);
        result.sensitiveWordMatches = wordMatches;

        // Process matches
        for (const match of wordMatches) {
          if (match.action === 'block') {
            result.allowed = false;
            const blockMsg = await this.settingsRepository.get('sensitive_word_block_message');
            result.warnings.push(blockMsg || '您的消息包含不合规内容，请修改后再试。');
            break;
          } else if (match.action === 'replace' && match.replacement) {
            // Replace the word in content (max 10 iterations to prevent infinite loops)
            let maxIterations = 10;
            let currentContent = result.filteredContent;
            const positions = this.findWordPositions(currentContent, match.word, match.match_mode);
            for (const pos of positions) {
              if (maxIterations-- <= 0) break;
              currentContent = this.replaceWordAt(currentContent, pos, match.length, match.replacement);
            }
            result.filteredContent = currentContent;
          } else if (match.action === 'warn') {
            const warnMsg = await this.settingsRepository.get('sensitive_word_warn_message');
            result.warnings.push(warnMsg || `提示：消息中包含可能不合适的"${match.word}"`);
          }
        }
      }

      // Check URLs
      const urlFilterEnabled = (await this.settingsRepository.get('url_filter_enabled')) === 'true';
      if (urlFilterEnabled && result.allowed) {
        const urlMatches = await this.checkUrls(content);
        result.urlMatches = urlMatches;

        const disallowedUrls = urlMatches.filter((m) => !m.isAllowed);
        if (disallowedUrls.length > 0) {
          result.allowed = false;
          const blockMessage =
            (await this.settingsRepository.get('url_block_message')) ||
            '抱歉,发送的链接不在白名单范围内';
          result.warnings.push(blockMessage);
        }
      }

      // Log if enabled
      if (options?.logEnabled && (result.sensitiveWordMatches.length > 0 || result.urlMatches.length > 0)) {
        await this.logFilterResults(result, options.conversationId);
      }

      // Fire-and-forget: increment hit counts
      this.incrementHitCounts(result).catch((err) => {
        logger.api.warn('Failed to increment filter hit counts', { error: err });
      });
    } catch (error) {
      // On error, block content (fail closed for security)
      logger.api.error('Content filter error, blocking content', { error, contentLength: content.length });
      result.allowed = false;
      result.warnings.push('内容安全检查失败，请稍后重试。');
    }

    return result;
  }

  /**
   * Check content for sensitive words
   */
  async checkSensitiveWords(content: string): Promise<SensitiveWordMatch[]> {
    const matches: SensitiveWordMatch[] = [];
    const normalizedContent = content.toLowerCase();

    const words = await this.getSensitiveWords();

    for (const wordConfig of words) {
      const positions = this.findWordPositions(content, wordConfig.word, wordConfig.match_mode);
      for (const pos of positions) {
        matches.push({
          word: wordConfig.word,
          position: pos,
          length: wordConfig.word.length,
          match_mode: wordConfig.match_mode,
          action: wordConfig.action,
          replacement: wordConfig.replacement,
          category: wordConfig.category,
        });
      }
    }

    // Sort by position (earlier matches first)
    matches.sort((a, b) => a.position - b.position);
    return matches;
  }

  /**
   * Check content for URLs
   */
  async checkUrls(content: string): Promise<UrlMatch[]> {
    const matches: UrlMatch[] = [];
    const urls = content.match(URL_REGEX) || [];

    if (urls.length === 0) {
      return matches;
    }

    const allowedDomains = await this.getAllowedDomains();

    for (const url of urls) {
      const domain = this.extractDomain(url);
      const isAllowed = this.isDomainAllowed(domain, allowedDomains);

      matches.push({
        url,
        domain,
        isAllowed,
      });

      // Increment hit count for allowed domains (for statistics)
      if (isAllowed) {
        this.repository.incrementDomainHitCount(domain).catch(() => {});
      }
    }

    return matches;
  }

  /**
   * Check if a domain is in the allowed list
   */
  isDomainAllowed(domain: string, allowedDomains?: Array<{ domain: string; pattern_type: 'exact' | 'wildcard' | 'suffix' }>): boolean {
    if (!allowedDomains) {
      return true; // No domains configured, allow all
    }

    const normalizedDomain = domain.toLowerCase();
    return allowedDomains.some((ad) => this.matchWildcardDomain(normalizedDomain, ad.domain.toLowerCase(), ad.pattern_type));
  }

  /**
   * Match domain with pattern (supports wildcards and suffix)
   * pattern_type: exact=精确匹配, wildcard=通配符(*.example.com匹配子域名), suffix=域名后缀
   */
  matchWildcardDomain(inputDomain: string, pattern: string, patternType: string): boolean {
    switch (patternType) {
      case 'exact':
        return inputDomain === pattern;

      case 'wildcard': {
        // *.example.com only matches subdomains like www.example.com, shop.example.com
        // Does NOT match example.com itself
        const suffix = pattern.replace(/^\*\./, '');
        return inputDomain !== suffix && inputDomain.endsWith('.' + suffix);
      }

      case 'suffix': {
        // example.com matches example.com and all subdomains (www.example.com, shop.example.com)
        return inputDomain === pattern || inputDomain.endsWith('.' + pattern);
      }

      default:
        return false;
    }
  }

  // ===== Private Helpers =====

  private async getSensitiveWords(): Promise<
    Array<{
      word: string;
      match_mode: 'exact' | 'fuzzy';
      action: 'block' | 'replace' | 'warn';
      replacement?: string;
      category: string;
    }>
  > {
    // Check cache
    if (this.sensitiveWordsCache && Date.now() - this.sensitiveWordsCache.timestamp < CACHE_TTL_MS) {
      return this.sensitiveWordsCache.words;
    }

    const rows = await this.repository.listSensitiveWords({ is_enabled: true });

    const words = rows.map((row) => ({
      word: row.word.toLowerCase(),
      match_mode: row.match_mode,
      action: row.action,
      replacement: row.replacement ?? undefined,
      category: row.category ?? '其他',
    }));

    // Enforce cache size limit
    const limitedWords = words.slice(0, MAX_CACHE_SIZE);

    this.sensitiveWordsCache = {
      words: limitedWords,
      timestamp: Date.now(),
    };

    return limitedWords;
  }

  private async getAllowedDomains(): Promise<Array<{ domain: string; pattern_type: 'exact' | 'wildcard' | 'suffix' }>> {
    // Check cache
    if (this.domainsCache && Date.now() - this.domainsCache.timestamp < CACHE_TTL_MS) {
      return this.domainsCache.domains;
    }

    const rows = await this.repository.listAllowedDomains({ is_enabled: true });

    const domains = rows.map((row) => ({
      domain: row.domain.toLowerCase(),
      pattern_type: row.pattern_type,
    }));

    // Enforce cache size limit
    const limitedDomains = domains.slice(0, MAX_CACHE_SIZE);

    this.domainsCache = {
      domains: limitedDomains,
      timestamp: Date.now(),
    };

    return domains;
  }

  private findWordPositions(content: string, word: string, matchMode: 'exact' | 'fuzzy'): number[] {
    const positions: number[] = [];
    const normalizedContent = content.toLowerCase();
    const normalizedWord = word.toLowerCase();

    if (matchMode === 'exact') {
      let pos = 0;
      while ((pos = normalizedContent.indexOf(normalizedWord, pos)) !== -1) {
        // Check word boundaries for exact match
        const before = pos === 0 || /[\s\u4e00-\u9fa5.,!?;:'"()[\]{}，。！？；：""''（）【】《》]/.test(content[pos - 1]);
        const after =
          pos + normalizedWord.length >= content.length ||
          /[\s\u4e00-\u9fa5.,!?;:'"()[\]{}，。！？；：""''（）【】《》]/.test(content[pos + normalizedWord.length]);

        if (before && after) {
          positions.push(pos);
        }
        pos += 1;
      }
    } else {
      // Fuzzy match: just contains the word
      let pos = 0;
      while ((pos = normalizedContent.indexOf(normalizedWord, pos)) !== -1) {
        positions.push(pos);
        pos += 1;
      }
    }

    return positions;
  }

  private replaceWordAt(content: string, position: number, length: number, replacement: string): string {
    return content.substring(0, position) + replacement + content.substring(position + length);
  }

  private extractDomain(url: string): string {
    const match = url.match(DOMAIN_REGEX);
    if (match) {
      // Remove protocol if present
      return match[0].replace(/^https?:\/\//, '').toLowerCase();
    }
    return url.toLowerCase();
  }

  private async logFilterResults(result: FilterResult, conversationId?: string): Promise<void> {
    try {
      // Log sensitive word matches
      for (const match of result.sensitiveWordMatches) {
        await this.repository.createFilterLog({
          conversation_id: conversationId,
          filter_type: 'sensitive_word',
          word: match.word,
          action: match.action === 'block' ? 'blocked' : match.action === 'replace' ? 'replaced' : 'warned',
          original_content: result.filteredContent,
          filtered_content: result.filteredContent !== result.filteredContent ? result.filteredContent : undefined,
        });
      }

      // Log URL matches
      for (const match of result.urlMatches) {
        if (!match.isAllowed) {
          await this.repository.createFilterLog({
            conversation_id: conversationId,
            filter_type: 'url',
            word: match.domain,
            action: 'blocked',
            original_content: result.filteredContent,
          });
        }
      }
    } catch (error) {
      logger.api.warn('Failed to log filter results', { error });
    }
  }

  private async incrementHitCounts(result: FilterResult): Promise<void> {
    // Increment sensitive word hit counts
    for (const match of result.sensitiveWordMatches) {
      await this.repository.incrementHitCount(match.word).catch(() => {});
    }
  }

  /**
   * Clear internal caches (useful when rules are updated)
   */
  clearCache(): void {
    this.sensitiveWordsCache = null;
    this.domainsCache = null;
  }

  /**
   * Get filter statistics
   */
  async getStats(): Promise<{
    sensitiveWordStats: { total: number; categories: Record<string, number> };
    domainStats: { total: number; enabled: number };
  }> {
    const [sensitiveWordStats, domainStats] = await Promise.all([
      this.repository.getSensitiveWordStats(),
      this.repository.getDomainStats(),
    ]);
    return { sensitiveWordStats, domainStats };
  }
}
