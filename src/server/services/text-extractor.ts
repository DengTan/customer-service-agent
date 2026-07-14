import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { createHash } from 'node:crypto';

/**
 * Normalize extracted text to clean Markdown/structured format:
 * - Replace consecutive spaces, newlines, tabs with single space
 * - Preserve document structure (headers, lists, tables)
 * - Normalize line endings
 * - Clean up common extraction artifacts
 */
export function normalizeToMarkdown(text: string): string {
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

export interface ChunkResult {
  index: number;
  content: string;
  content_hash: string;
}

export interface ChunkPreview {
  index: number;
  content: string;
  content_hash: string;
}

const SUPPORTED_EXTENSIONS = [
  '.xlsx', '.xls', '.csv',
  '.pdf', '.docx', '.doc',
  '.md', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
];

export function getFileType(filename: string): string {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  if (ext === '.xlsx' || ext === '.xls') return 'excel';
  if (ext === '.csv') return 'csv';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.md') return 'markdown';
  if (ext === '.txt') return 'text';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image';
  return 'unknown';
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import to avoid test file issues
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    throw new Error('PDF解析失败');
  }
}

export async function extractTextFromBuffer(buffer: Buffer, fileType: string): Promise<string> {
  switch (fileType) {
    case 'excel':
      return extractExcelText(buffer);
    case 'csv':
      return extractCsvText(buffer);
    case 'pdf':
      return extractPdfText(buffer);
    case 'docx':
      return extractDocxText(buffer);
    case 'markdown':
    case 'text':
      return buffer.toString('utf-8');
    case 'image':
      // Images cannot be converted to text; return empty string
      // The image reference (URL) is stored in image_url field instead
      return '';
    default:
      throw new Error(`不支持的文件类型: ${fileType}`);
  }
}

function extractExcelText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const textParts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert to markdown table format for better readability
    const markdownTable = sheetToMarkdown(sheet);
    textParts.push(`[Sheet: ${sheetName}]\n${markdownTable}`);
  }

  return textParts.join('\n\n');
}

/**
 * Convert Excel sheet to Markdown table format
 */
function sheetToMarkdown(sheet: XLSX.WorkSheet): string {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows: string[][] = [];

  // Read all cells
  for (let R = range.s.r; R <= range.e.r; ++R) {
    const row: string[] = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[cellAddress];
      const cellValue = cell?.v ?? '';
      // Escape pipe characters in cell content
      row.push(String(cellValue).replace(/\|/g, '\\|'));
    }
    rows.push(row);
  }

  if (rows.length === 0) return '';

  // Build markdown table
  const markdownRows: string[] = [];

  // Header row
  markdownRows.push('| ' + rows[0].join(' | ') + ' |');

  // Separator row
  const colCount = rows[0].length;
  markdownRows.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    // Pad row if necessary
    while (rows[i].length < colCount) {
      rows[i].push('');
    }
    markdownRows.push('| ' + rows[i].slice(0, colCount).join(' | ') + ' |');
  }

  return markdownRows.join('\n');
}

function extractCsvText(buffer: Buffer): string {
  return buffer.toString('utf-8');
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    // Use mammoth to extract raw text
    const result = await mammoth.extractRawText({ buffer });
    // Normalize the text output
    return normalizeToMarkdown(result.value);
  } catch {
    throw new Error('DOCX解析失败');
  }
}

export function chunkText(text: string, chunkSize: number = 500): ChunkResult[] {
  // Split by double newlines first (paragraphs)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  
  const chunks: ChunkResult[] = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    
    // If single paragraph exceeds chunk size, split by sentences
    if (trimmedParagraph.length > chunkSize) {
      if (currentChunk.trim()) {
        chunks.push(createChunk(chunkIndex++, currentChunk.trim()));
        currentChunk = '';
      }
      
      // Split long paragraph by sentences
      const sentences = trimmedParagraph.split(/(?<=[。！？.!?])/);
      for (const sentence of sentences) {
        if (sentence.trim().length > chunkSize) {
          // Split by comma if sentence is still too long
          const parts = sentence.split(/(?<=[，,])/);
          for (const part of parts) {
            if ((currentChunk + part).length > chunkSize) {
              if (currentChunk.trim()) {
                chunks.push(createChunk(chunkIndex++, currentChunk.trim()));
                currentChunk = '';
              }
              // If single part still exceeds, truncate with ellipsis
              if (part.length > chunkSize * 1.5) {
                const truncated = part.slice(0, chunkSize * 1.5) + '...';
                chunks.push(createChunk(chunkIndex++, truncated.trim()));
              } else {
                currentChunk = part;
              }
            } else {
              currentChunk += part;
            }
          }
        } else if ((currentChunk + sentence).length > chunkSize) {
          chunks.push(createChunk(chunkIndex++, currentChunk.trim()));
          currentChunk = sentence;
        } else {
          currentChunk += sentence;
        }
      }
    } else if ((currentChunk + '\n\n' + trimmedParagraph).length > chunkSize) {
      if (currentChunk.trim()) {
        chunks.push(createChunk(chunkIndex++, currentChunk.trim()));
      }
      currentChunk = trimmedParagraph;
    } else {
      if (currentChunk) {
        currentChunk += '\n\n';
      }
      currentChunk += trimmedParagraph;
    }
  }

  // Add remaining chunk
  if (currentChunk.trim()) {
    chunks.push(createChunk(chunkIndex, currentChunk.trim()));
  }

  return chunks;
}

function createChunk(index: number, content: string): ChunkResult {
  return {
    index,
    content,
    content_hash: createHash('sha256').update(content).digest('hex'),
  };
}

export function extractChunkPreview(chunks: ChunkResult[]): ChunkPreview[] {
  return chunks.slice(0, 5).map(c => ({
    index: c.index,
    content: c.content,
    content_hash: c.content_hash,
  }));
}

export function extractRawTextPreview(text: string, maxLength: number = 5000): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n\n... (内容过长已截断)';
}

export function computeContentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export { SUPPORTED_EXTENSIONS };
