import { createHash } from 'node:crypto';
import { LLMClientAdapter } from './llm-client-adapter';
import { getSettingsRepository } from '@/server/repositories/settings-repository';
import { LlmProviderService } from './llm-provider-service';
import { logger } from '@/lib/logger';
import { FACTORY_DEFAULTS } from '@/lib/settings-defaults';

export interface ChunkRecord {
  index: number;
  content: string;
  content_hash: string;
}

export interface SmartChunkOptions {
  chunkSize?: number;       // 目标 chunk 字符数（默认 500）
  overlap?: number;          // 重叠字符数（默认 50）
  enableLLMChunking?: boolean; // 是否启用 LLM 智能分段（默认 true）
}

// ========== LLM 调用成本控制 ==========

// 缓存已分段的内容哈希，避免重复调用 LLM
const contentHashCache = new Map<string, ChunkRecord[]>();
const CACHE_MAX_SIZE = 100; // 最多缓存 100 条
const CACHE_TTL_MS = 30 * 60 * 1000; // 缓存 30 分钟

// 并发控制信号量
let concurrentCalls = 0;
const MAX_CONCURRENT_CALLS = 3; // 最多 3 个并发 LLM 调用

// 超时控制（毫秒）
const LLM_CHUNK_TIMEOUT_MS = 30 * 1000; // 30 秒超时

function getCacheKey(textHash: string, chunkSize: number): string {
  return `${textHash}:${chunkSize}`;
}

function getContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').substring(0, 16);
}

function getFromCache(textHash: string, chunkSize: number): ChunkRecord[] | null {
  const key = getCacheKey(textHash, chunkSize);
  const cached = contentHashCache.get(key);
  if (cached) {
    logger.debug('[SmartChunk] Cache hit', { key });
    return cached;
  }
  return null;
}

function setToCache(textHash: string, chunkSize: number, chunks: ChunkRecord[]): void {
  // 缓存满了，清理最旧的条目
  if (contentHashCache.size >= CACHE_MAX_SIZE) {
    const firstKey = contentHashCache.keys().next().value;
    if (firstKey) {
      contentHashCache.delete(firstKey);
      logger.debug('[SmartChunk] Cache evicted oldest entry', { evictedKey: firstKey });
    }
  }
  const key = getCacheKey(textHash, chunkSize);
  contentHashCache.set(key, chunks);
}

async function acquireSemaphore(): Promise<() => void> {
  while (concurrentCalls >= MAX_CONCURRENT_CALLS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  concurrentCalls++;
  return () => {
    concurrentCalls--;
  };
}

// ========== 文本规范化 ==========

/**
 * Normalize text to clean Markdown/structured format:
 * - Replace consecutive spaces, newlines, tabs with single space
 * - Preserve document structure (headers, lists, tables)
 * - Normalize line endings
 */
export function normalizeTextToMarkdown(text: string): string {
  if (!text) return '';

  const result: string[] = [];
  let lastWasEmpty = false;

  const lines = text
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Split into lines
    .split('\n');

  for (const line of lines) {
    // Preserve leading/trailing spaces in code blocks (lines starting with spaces)
    const isCodeBlock = line.trimStart().startsWith('```') || /^\s{4,}/.test(line);
    const processedLine = isCodeBlock ? line : line.replace(/[ \t]+/g, ' ').trimEnd();

    // Remove consecutive empty lines
    if (processedLine === '' && lastWasEmpty) {
      continue;
    }
    result.push(processedLine);
    lastWasEmpty = processedLine === '';
  }

  return result.join('\n').trim();
}

// ========== 核心分段逻辑 ==========

/**
 * Smart chunking using LLM for intelligent text segmentation.
 * Falls back to rule-based chunking if LLM fails.
 * 
 * 成本控制策略:
 * 1. 内容哈希缓存：相同内容不重复调用 LLM
 * 2. 并发限制：最多 3 个并发调用
 * 3. 超时控制：30 秒超时
 * 4. 自动降级：LLM 失败自动回退规则分段
 */
export async function smartChunkText(
  text: string,
  options: SmartChunkOptions = {}
): Promise<ChunkRecord[]> {
  // Read settings for defaults
  const settingsRepo = getSettingsRepository();
  const [smartChunkingEnabled, settingChunkSize, settingOverlap] = await Promise.all([
    settingsRepo.get('knowledge_smart_chunking_enabled'),
    settingsRepo.get('knowledge_chunk_size'),
    settingsRepo.get('knowledge_chunk_overlap'),
  ]);

  const enableLLMChunking = options.enableLLMChunking ?? (smartChunkingEnabled !== 'false');
  const parsedChunkSize = settingChunkSize ? parseInt(settingChunkSize, 10) : NaN;
  const parsedOverlap = settingOverlap ? parseInt(settingOverlap, 10) : NaN;
  const defaultChunkSize = parseInt(FACTORY_DEFAULTS.knowledge_chunk_size || '500', 10);
  const defaultOverlap = parseInt(FACTORY_DEFAULTS.knowledge_chunk_overlap || '50', 10);
  const chunkSize = options.chunkSize ?? (Number.isNaN(parsedChunkSize) ? defaultChunkSize : parsedChunkSize);
  const overlap = options.overlap ?? (Number.isNaN(parsedOverlap) ? defaultOverlap : parsedOverlap);

  // Step 1: Normalize text to clean Markdown format
  const normalizedText = normalizeTextToMarkdown(text);

  if (!normalizedText || normalizedText.trim().length === 0) {
    return [];
  }

  // Step 2: Check cache first
  const textHash = getContentHash(normalizedText);
  const cachedChunks = getFromCache(textHash, chunkSize);
  if (cachedChunks) {
    return cachedChunks;
  }

  // Step 3: Try LLM-based chunking first
  // Pre-compute estimatedChunks for logging in catch block
  const estimatedChunks = Math.ceil(normalizedText.length / chunkSize);

  if (enableLLMChunking && normalizedText.length > chunkSize) {
    try {
      const llmChunks = await chunkTextByLLM(normalizedText, chunkSize);
      if (llmChunks.length > 0) {
        // 缓存结果
        setToCache(textHash, chunkSize, llmChunks);
        logger.debug('[SmartChunk] LLM chunking successful', {
          originalLength: text.length,
          chunkCount: llmChunks.length,
          cacheKey: getCacheKey(textHash, chunkSize)
        });
        return llmChunks;
      }
    } catch (error) {
      logger.warn('[SmartChunk] LLM chunking failed, falling back to rule-based', {
        error: error instanceof Error ? error.message : String(error),
        textLength: normalizedText.length,
        estimatedChunks,
      });
    }
  }

  // Step 4: Fallback to rule-based chunking
  const ruleChunks = ruleBasedChunkText(normalizedText, chunkSize, overlap);
  
  // 规则分段结果也缓存（避免重复计算）
  if (ruleChunks.length > 0) {
    setToCache(textHash, chunkSize, ruleChunks);
  }
  
  return ruleChunks;
}

/**
 * Use LLM to intelligently chunk text into semantic segments.
 * The LLM will identify natural topic boundaries and split accordingly.
 * 
 * 包含:
 * - 并发控制（信号量）
 * - 超时控制
 * - 备选解析格式
 */
async function chunkTextByLLM(text: string, targetChunkSize: number): Promise<ChunkRecord[]> {
  // 获取信号量
  const release = await acquireSemaphore();
  const startTime = Date.now();

  // Use fallback defaults as baseline; provider-specific branches override these.
  // Declared here (before the outer try) so the outer catch block can also reference them.
  let baseUrl: string = process.env.COZE_BASE_URL || 'https://api.coze.cn';
  let apiKey: string = process.env.COZE_API_KEY || '';
  let model: string = 'doubao-seed-2-0-lite-260215';
  let providerSource = 'error-fallback:coze';

  try {
    const settingsRepo = getSettingsRepository();

    // Get LLM configuration from settings
    const [aiModel, llmProviderId] = await Promise.all([
      settingsRepo.get('ai_model'),
      settingsRepo.get('llm_provider_id'),
    ]);

    // Initialize model with aiModel now that we have it from settings
    model = aiModel || 'doubao-seed-2-0-lite-260215';

    try {
      if (llmProviderId && llmProviderId !== 'coze') {
        // 显式指定的非 Coze 提供商
        const llmProviderService = new LlmProviderService();
        const provider = await llmProviderService.getProviderWithDecryptedKey(llmProviderId);
        if (!provider) {
          throw new Error(`Provider ${llmProviderId} not found`);
        }
        baseUrl = provider.base_url;
        apiKey = provider.api_key || '';
        model = provider.default_model || aiModel || 'gpt-4o';
        providerSource = `provider:${llmProviderId}`;
      } else {
        // 未指定提供商，尝试获取默认提供商
        const llmProviderService = new LlmProviderService();
        const defaultProvider = await llmProviderService.getDefaultProvider();
        if (defaultProvider && defaultProvider.is_enabled) {
          // 需要解密 API key 才能调用
          const providerWithKey = await llmProviderService.getProviderWithDecryptedKey(defaultProvider.id);
          if (providerWithKey?.api_key) {
            baseUrl = providerWithKey.base_url;
            apiKey = providerWithKey.api_key;
            model = providerWithKey.default_model || aiModel || 'gpt-4o';
            providerSource = `default:${defaultProvider.name}`;
          } else if (llmProviderId === 'coze' || !llmProviderId) {
            baseUrl = process.env.COZE_BASE_URL || 'https://api.coze.cn';
            apiKey = process.env.COZE_API_KEY || '';
            model = aiModel || 'doubao-seed-2-0-lite-260215';
            providerSource = llmProviderId === 'coze' ? 'explicit:coze' : 'fallback:coze';
          } else {
            throw new Error('Default provider has no API key');
          }
        } else if (!defaultProvider || !defaultProvider.is_enabled) {
          // 无可用默认提供商，使用 Coze
          if (llmProviderId === 'coze' || !llmProviderId) {
            baseUrl = process.env.COZE_BASE_URL || 'https://api.coze.cn';
            apiKey = process.env.COZE_API_KEY || '';
            model = aiModel || 'doubao-seed-2-0-lite-260215';
            providerSource = llmProviderId === 'coze' ? 'explicit:coze' : 'fallback:coze';
          } else {
            throw new Error('No available LLM provider');
          }
        }
      }
    } catch (providerError) {
      logger.warn('[SmartChunk] Failed to get LLM provider, falling back to Coze', {
        error: providerError instanceof Error ? providerError.message : String(providerError),
        llmProviderId,
      });
      // Variables already hold fallback values from their pre-try initialization above
    }

    logger.debug('[SmartChunk] Using LLM provider', { providerSource, model, baseUrl });

    if (!apiKey) {
      logger.warn('[SmartChunk] No API key available for LLM chunking');
      return [];
    }

    const adapter = new LLMClientAdapter({ baseUrl, apiKey });

    // Estimate number of chunks based on text length
    const estimatedChunks = Math.ceil(text.length / targetChunkSize);

    // 超时保护
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('LLM chunking timeout after 30s')), LLM_CHUNK_TIMEOUT_MS);
    });

    const systemPrompt = `你是一个专业的文档处理助手，负责将长文档智能切分为语义完整的段落。

任务要求：
1. 分析文档的语义结构，识别主题切换点
2. 每个 chunk 应包含一个完整的语义单元（段落、章节或逻辑段落组）
3. 优先在自然断点处切分（如：标题变换、话题切换，空行分隔）
4. 保持每个 chunk 的语义完整性，避免在句子中间切分
5. 每个 chunk 的目标长度约为 ${targetChunkSize} 字符

输出格式：
请将文档切分为若干段落，每段用三个反引号包裹：
\`\`\`chunk_1
第一段的内容...
\`\`\`
\`\`\`chunk_2
第二段的内容...
\`\`\`
...

注意：
- 不要修改原文内容，只做分段
- 保持原有格式（Markdown 列表、代码块等）
- 如果原文很短（少于 ${targetChunkSize} 字符），保持为单一 chunk`;

    const userPrompt = `请将以下文档智能切分为语义完整的段落（目标 ${estimatedChunks} 个段落）：\n\n${text}`;

    const llmPromise = adapter.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        model,
        temperature: 0.1, // Low temperature for consistent chunking
        max_tokens: 8192,
      }
    );

    // 竞态：LLM 调用 vs 超时
    const result = await Promise.race([llmPromise, timeoutPromise]);

    const elapsed = Date.now() - startTime;
    logger.info('[SmartChunk] LLM call completed', { elapsedMs: elapsed, model, providerSource });

    const content = result.content;
    if (!content) {
      return [];
    }

    // Parse chunks from LLM response
    const chunks = parseLLMResponse(content, targetChunkSize);
    
    // 如果解析结果为空，尝试规则分段作为备选
    if (chunks.length === 0) {
      logger.warn('[SmartChunk] LLM response parsing returned empty, using rule-based fallback', {
        responsePreview: content.substring(0, 500),
      });
      return [];
    }

    return chunks;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('[SmartChunk] LLM chunking error', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: elapsed,
      providerSource,
    });
    throw error; // 重新抛出，让上层处理回退
  } finally {
    release(); // 释放信号量
  }
}

/**
 * 解析 LLM 返回的分段结果
 * 支持多种格式
 */
function parseLLMResponse(content: string, targetChunkSize: number): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];

  // 格式 1: ```chunk_N ... ```
  const chunkPattern = /```chunk_\d+\s*([\s\S]*?)```/g;
  let match;
  let index = 0;

  while ((match = chunkPattern.exec(content)) !== null) {
    const chunkContent = match[1].trim();
    if (chunkContent.length > 0) {
      chunks.push({
        index: index++,
        content: chunkContent,
        content_hash: hashContent(chunkContent),
      });
    }
  }

  if (chunks.length > 0) {
    return chunks;
  }

  // 格式 2: 编号列表格式
  const lines = content.split('\n');
  let currentChunk = '';
  let chunkIndex = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check if this line looks like a new chunk marker
    const isNewChunk = /^(?:\d+[.、)]\s*|\[[\d\w]+\]\s*)/.test(trimmedLine);

    if (isNewChunk && currentChunk.length > 0) {
      if (currentChunk.trim().length > 50) { // 过滤太短的片段
        chunks.push({
          index: chunkIndex++,
          content: currentChunk.trim(),
          content_hash: hashContent(currentChunk.trim()),
        });
      }
      currentChunk = trimmedLine.replace(/^(?:\d+[.、)]\s*|\[[\d\w]+\]\s*)/, '');
    } else {
      currentChunk += (currentChunk ? '\n' : '') + trimmedLine;
    }
  }

  // Add last chunk
  if (currentChunk.trim().length > 50) {
    chunks.push({
      index: chunkIndex,
      content: currentChunk.trim(),
      content_hash: hashContent(currentChunk.trim()),
    });
  }

  return chunks;
}

// ========== 辅助函数 ==========

/**
 * 在 content 末尾截取不超过 maxLen 字符，从最近的句子边界处截断。
 * 防止在句子中间切断，破坏语义完整性。
 */
function carryOverlap(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  // 从末尾往前找最近的句末标点
  const tail = content.slice(-maxLen);
  const lastBoundary = Math.max(
    tail.lastIndexOf('。'),
    tail.lastIndexOf('！'),
    tail.lastIndexOf('？'),
    tail.lastIndexOf('.'),
    tail.lastIndexOf('!'),
    tail.lastIndexOf('?'),
  );
  // 如果找到边界（且边界前还有内容），从边界后开始截取
  if (lastBoundary >= 0 && lastBoundary < tail.length - 1) {
    return content.slice(-(maxLen - lastBoundary - 1));
  }
  // 没找到句末标点，退回到逗号/分号/冒号边界
  const subBoundary = Math.max(
    tail.lastIndexOf('，'),
    tail.lastIndexOf(','),
    tail.lastIndexOf('：'),
    tail.lastIndexOf(':'),
    tail.lastIndexOf('；'),
    tail.lastIndexOf(';'),
  );
  if (subBoundary >= 0 && subBoundary < tail.length - 1) {
    return content.slice(-(maxLen - subBoundary - 1));
  }
  // 都没有，退回简单截断
  return content.slice(-maxLen);
}

// ========== 规则分段（兜底方案） ==========

/**
 * Rule-based chunking (fallback):
 * - Split by paragraphs (double newlines)
 * - For long paragraphs, split by sentence boundaries with overlap
 * - NEVER cut in the middle of a sentence
 */
function ruleBasedChunkText(text: string, chunkSize: number, overlapSize: number): ChunkRecord[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const records: ChunkRecord[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    // Long paragraph: split by sentences first, then accumulate
    if (para.length > chunkSize) {
      if (buffer.length >= 100) {
        records.push(makeRecord(records.length, buffer));
        buffer = '';
      }

      // Split by sentence-ending punctuation (Chinese and English)
      const sentenceRegex = /(?<=[。！？.!?；;])/g;
      const sentences = para.split(sentenceRegex).map(s => s.trim()).filter(Boolean);
      let currentChunk = '';

      for (const sentence of sentences) {
        if (!sentence) continue;

        // If a single sentence exceeds chunkSize, split by comma/clause boundaries
        if (sentence.length > chunkSize) {
          // Flush current chunk if not empty
          if (currentChunk.length >= 100) {
            records.push(makeRecord(records.length, currentChunk));
            // Carry overlap into next chunk
            currentChunk = carryOverlap(currentChunk, overlapSize);
          } else {
            currentChunk = '';
          }

          // Split long sentence by clauses (Chinese comma / English comma / colon)
          const clauseRegex = /(?<=[，,：:])/g;
          const clauses = sentence.split(clauseRegex).map(c => c.trim()).filter(Boolean);
          let subChunk = '';

          for (const clause of clauses) {
            if (!clause) continue;
            if (subChunk.length + clause.length + 1 > chunkSize) {
              if (subChunk.length >= 100) {
                records.push(makeRecord(records.length, subChunk));
                subChunk = carryOverlap(subChunk, overlapSize);
              } else {
                subChunk = '';
              }
            }
            subChunk += (subChunk ? '，' : '') + clause;
          }

          // Flush remaining sub-chunk
          if (subChunk.length >= 100) {
            records.push(makeRecord(records.length, subChunk));
          } else if (subChunk.length > 0) {
            currentChunk += (currentChunk ? '。' : '') + subChunk;
          }
          continue;
        }

        // Normal sentence: try to accumulate with buffer
        if (currentChunk.length + sentence.length + 1 > chunkSize) {
          if (currentChunk.length >= 100) {
            records.push(makeRecord(records.length, currentChunk));
            // Carry overlap
            currentChunk = carryOverlap(currentChunk, overlapSize);
          } else {
            currentChunk = '';
          }
        }
        currentChunk += (currentChunk ? '。' : '') + sentence;
      }

      // Flush remaining sentences in current paragraph
      if (currentChunk.length >= 100) {
        records.push(makeRecord(records.length, currentChunk));
      } else if (currentChunk.length > 0) {
        buffer += (buffer ? '\n\n' : '') + currentChunk;
      }
      continue;
    }

    // Short paragraph: accumulate with buffer
    if (buffer.length + para.length + 2 > chunkSize) {
      if (buffer.length >= 100) {
        records.push(makeRecord(records.length, buffer));
        buffer = '';
      }
    }
    buffer += (buffer ? '\n\n' : '') + para;
  }

  // Handle remaining buffer
  if (buffer.length >= 100) {
    records.push(makeRecord(records.length, buffer));
  } else if (buffer.length > 0 && records.length > 0) {
    // Merge short remainder into last chunk
    const last = records[records.length - 1];
    last.content = last.content + '\n\n' + buffer;
    last.content_hash = hashContent(last.content);
  } else if (buffer.length > 0) {
    records.push(makeRecord(0, buffer));
  }

  return records;
}

function makeRecord(index: number, content: string): ChunkRecord {
  return {
    index,
    content: content.trim(),
    content_hash: hashContent(content.trim()),
  };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ========== 缓存清理（可选调用） ==========

/**
 * 清理过期的缓存条目
 * 建议定时调用，如每小时一次
 */
export function clearChunkCache(): void {
  const size = contentHashCache.size;
  contentHashCache.clear();
  logger.info('[SmartChunk] Cache cleared', { clearedEntries: size });
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: contentHashCache.size,
    maxSize: CACHE_MAX_SIZE,
  };
}
