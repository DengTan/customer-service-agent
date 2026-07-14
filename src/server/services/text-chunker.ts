import { createHash } from 'node:crypto';

export interface ChunkRecord {
  index: number;
  content: string;
  content_hash: string;
}

export interface ChunkDiffEntry {
  type: 'added' | 'removed' | 'modified';
  chunk_index: number;
  old_hash?: string;
  new_hash?: string;
}

export interface ChunkDiffSummary {
  added: number;
  removed: number;
  modified: number;
  total_after: number;
}

const DEFAULT_CHUNK_SIZE = 500;       // 目标 chunk 字符数
const MIN_CHUNK_SIZE = 100;            // 最小 chunk 字符数（避免切得太碎）
const OVERLAP_SIZE = 50;               // 重叠字符数

/**
 * 切分文本为 chunks。
 * 规则：
 *  1. 优先按段落（双换行）切分
 *  2. 段落过长：先按句子边界切分，再按目标字符数累积
 *  3. 单句过长：按逗号/分号/冒号等子句边界切分
 *  4. 决不在句子中间截断
 *
 * 确定性：相同输入 → 相同输出（顺序+索引+内容）。这保证 diff 算法有效。
 */
export function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE): ChunkRecord[] {
  if (!text || text.trim().length === 0) return [];

  // 归一化：去掉零宽字符、压缩空白
  const normalized = text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // 1) 段落切分
  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  // 2) 段落 → 句子级切分
  const records: ChunkRecord[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    // Long paragraph: split by sentences, then accumulate
    if (para.length > chunkSize) {
      if (buffer.length >= MIN_CHUNK_SIZE) {
        records.push(makeRecord(records.length, buffer));
        buffer = '';
      }

      // 按句末标点切分（中文句号/问号/感叹号，英文 .!?）
      const sentenceRegex = /(?<=[。！？.!?；;])/g;
      const sentences = para.split(sentenceRegex).map(s => s.trim()).filter(Boolean);
      let currentChunk = '';

      for (const sentence of sentences) {
        if (!sentence) continue;

        // 超长单句：按逗号/冒号等子句边界切分
        if (sentence.length > chunkSize) {
          // Flush 当前累积
          if (currentChunk.length >= MIN_CHUNK_SIZE) {
            records.push(makeRecord(records.length, currentChunk));
            // 携带重叠：保留末尾部分内容
            currentChunk = currentChunk.slice(-Math.min(OVERLAP_SIZE, Math.floor(currentChunk.length / 2)));
          } else {
            currentChunk = '';
          }

          // 子句级切分
          const clauseRegex = /(?<=[，,：:])/g;
          const clauses = sentence.split(clauseRegex).map(c => c.trim()).filter(Boolean);
          let subChunk = '';

          for (const clause of clauses) {
            if (!clause) continue;
            if (subChunk.length + clause.length + 1 > chunkSize) {
              if (subChunk.length >= MIN_CHUNK_SIZE) {
                records.push(makeRecord(records.length, subChunk));
                subChunk = subChunk.slice(-Math.min(OVERLAP_SIZE, Math.floor(subChunk.length / 2)));
              } else {
                subChunk = '';
              }
            }
            subChunk += (subChunk ? '，' : '') + clause;
          }

          // 剩余子句并入
          if (subChunk.length >= MIN_CHUNK_SIZE) {
            records.push(makeRecord(records.length, subChunk));
          } else if (subChunk.length > 0) {
            currentChunk += (currentChunk ? '。' : '') + subChunk;
          }
          continue;
        }

        // 普通句子：尝试累积
        if (currentChunk.length + sentence.length + 1 > chunkSize) {
          if (currentChunk.length >= MIN_CHUNK_SIZE) {
            records.push(makeRecord(records.length, currentChunk));
            currentChunk = currentChunk.slice(-Math.min(OVERLAP_SIZE, Math.floor(currentChunk.length / 2)));
          } else {
            currentChunk = '';
          }
        }
        currentChunk += (currentChunk ? '。' : '') + sentence;
      }

      // 当前段落剩余句子
      if (currentChunk.length >= MIN_CHUNK_SIZE) {
        records.push(makeRecord(records.length, currentChunk));
      } else if (currentChunk.length > 0) {
        buffer += (buffer ? '\n\n' : '') + currentChunk;
      }
      continue;
    }

    // Short paragraph: accumulate with buffer
    if (buffer.length + para.length + 2 > chunkSize) {
      if (buffer.length >= MIN_CHUNK_SIZE) {
        records.push(makeRecord(records.length, buffer));
        buffer = '';
      }
    }
    buffer += (buffer ? '\n\n' : '') + para;
  }

  if (buffer.length >= MIN_CHUNK_SIZE) {
    records.push(makeRecord(records.length, buffer));
  } else if (buffer.length > 0 && records.length > 0) {
    // 太短则并入最后一条
    const last = records[records.length - 1];
    last.content = last.content + '\n\n' + buffer;
    last.content_hash = hash(last.content);
  } else if (buffer.length > 0) {
    records.push(makeRecord(0, buffer));
  }
  return records;
}

function makeRecord(index: number, content: string): ChunkRecord {
  return {
    index,
    content: content.trim(),
    content_hash: hash(content),
  };
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 计算旧 chunks 与新 chunks 之间的 diff。
 * 算法：按 index + hash 双键匹配。
 *   - index 相同但 hash 不同 → modified
 *   - 仅出现在 new → added
 *   - 仅出现在 old → removed
 */
export function diffChunks(
  oldChunks: Array<{ index: number; content_hash: string }>,
  newChunks: Array<{ index: number; content_hash: string }>,
): ChunkDiffEntry[] {
  const oldByIndex = new Map<number, { index: number; content_hash: string }>();
  oldChunks.forEach(c => oldByIndex.set(c.index, c));
  const newByIndex = new Map<number, { index: number; content_hash: string }>();
  newChunks.forEach(c => newByIndex.set(c.index, c));

  const allIndexes = new Set<number>([...oldByIndex.keys(), ...newByIndex.keys()]);
  const diff: ChunkDiffEntry[] = [];
  const sorted = [...allIndexes].sort((a, b) => a - b);
  for (const idx of sorted) {
    const oldC = oldByIndex.get(idx);
    const newC = newByIndex.get(idx);
    if (oldC && !newC) {
      diff.push({ type: 'removed', chunk_index: idx, old_hash: oldC.content_hash });
    } else if (!oldC && newC) {
      diff.push({ type: 'added', chunk_index: idx, new_hash: newC.content_hash });
    } else if (oldC && newC && oldC.content_hash !== newC.content_hash) {
      diff.push({ type: 'modified', chunk_index: idx, old_hash: oldC.content_hash, new_hash: newC.content_hash });
    }
  }
  return diff;
}

export function summarizeDiff(diff: ChunkDiffEntry[], totalAfter: number): ChunkDiffSummary {
  let added = 0, removed = 0, modified = 0;
  for (const e of diff) {
    if (e.type === 'added') added++;
    else if (e.type === 'removed') removed++;
    else if (e.type === 'modified') modified++;
  }
  return { added, removed, modified, total_after: totalAfter };
}
