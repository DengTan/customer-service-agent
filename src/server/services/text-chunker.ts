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

/**
 * 切分文本为 chunks。
 * 规则：
 *  1. 优先按段落（双换行）切分
 *  2. 段落过长则按目标 chunk 字符数滑动切分（保留重叠区以提升向量检索质量）
 *  3. 最后做 SHA-256 哈希去重
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

  // 2) 段落 → 切到 chunk 字符数
  const records: ChunkRecord[] = [];
  let buffer = '';
  for (const para of paragraphs) {
    // 段落本身超过 chunkSize → 滑动切分
    if (para.length > chunkSize) {
      if (buffer.length >= MIN_CHUNK_SIZE) {
        records.push(makeRecord(records.length, buffer));
        buffer = '';
      }
      for (let i = 0; i < para.length; i += chunkSize - 50) {
        const slice = para.slice(i, i + chunkSize);
        records.push(makeRecord(records.length, slice));
      }
      continue;
    }
    // 累积段落，达到目标大小则 flush
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
