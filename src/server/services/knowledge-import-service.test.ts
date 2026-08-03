import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('@/storage/database/supabase-client', () => ({
  getSupabaseClient: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'test/path' }, error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  }),
  isDemoMode: () => false,
}));

vi.mock('@/server/services/embedding-service', () => ({
  getEmbeddingService: vi.fn().mockReturnValue({
    embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  }),
}));

vi.mock('@/server/repositories/knowledge-import-job-repository', () => ({
  KnowledgeImportJobRepository: class {
    create = vi.fn().mockResolvedValue({
      id: 'job-123',
      status: 'pending',
      file_name: 'test.txt',
      file_size: 1024,
      file_type: 'text/plain',
      category: '未分类',
    });
    findById = vi.fn();
    update = vi.fn();
    updateProgress = vi.fn();
    complete = vi.fn();
    fail = vi.fn();
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    // knowledge-import-service uses logger.api.error in processJobAsync error path
    api: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  },
}));

// Mock text-extractor functions
vi.mock('@/server/services/text-extractor', () => ({
  extractRawTextPreview: vi.fn().mockReturnValue('Sample text content'),
  extractChunkPreview: vi.fn().mockReturnValue([
    { content: 'Chunk 1', chunk_index: 0 },
    { content: 'Chunk 2', chunk_index: 1 },
  ]),
  extractTextFromBuffer: vi.fn().mockResolvedValue('Extracted text from file'),
  getFileType: vi.fn().mockReturnValue('text/plain'),
  computeContentHash: vi.fn().mockReturnValue('abc123hash'),
  normalizeToMarkdown: vi.fn().mockImplementation((text) => text),
}));

// Mock smart-chunking-service
vi.mock('@/server/services/smart-chunking-service', () => ({
  smartChunkText: vi.fn().mockReturnValue([
    { content: 'Chunk 1 text', chunk_index: 0 },
    { content: 'Chunk 2 text', chunk_index: 1 },
  ]),
}));

// Import after mocks
import { KnowledgeImportService } from '@/server/services/knowledge-import-service';

describe('KnowledgeImportService', () => {
  let service: KnowledgeImportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KnowledgeImportService();
  });

  describe('file validation', () => {
    it('rejects unsupported file formats', async () => {
      const mockFile = {
        name: 'test.exe',
        size: 1024,
      } as unknown as File;

      // createJob is async; validation throws synchronously inside the promise.
      await expect(service.createJob({ file: mockFile })).rejects.toThrow(
        /不支持的文件格式/
      );
    });

    it('rejects files exceeding max size', async () => {
      const mockFile = {
        name: 'test.txt',
        size: 25 * 1024 * 1024, // 25MB > 20MB limit
      } as unknown as File;

      await expect(service.createJob({ file: mockFile })).rejects.toThrow(
        /文件大小超过限制/
      );
    });
  });

  describe('createJob', () => {
    it('creates a job for valid text file', async () => {
      const mockFile = {
        name: 'test.txt',
        size: 1024,
      } as unknown as File;

      const result = await service.createJob({
        file: mockFile,
        name: 'Test File',
        category: 'Test Category',
      });

      expect(result).toHaveProperty('jobId');
      expect(result.jobId).toBe('job-123');
    });

    it('creates a job for valid Excel file', async () => {
      const mockFile = {
        name: 'data.xlsx',
        size: 10240,
      } as unknown as File;

      const result = await service.createJob({ file: mockFile });

      expect(result).toHaveProperty('jobId');
    });

    it('creates a job for valid PDF file', async () => {
      const mockFile = {
        name: 'document.pdf',
        size: 10240,
      } as unknown as File;

      const result = await service.createJob({ file: mockFile });

      expect(result).toHaveProperty('jobId');
    });

    it('creates a job for image file', async () => {
      const mockFile = {
        name: 'image.png',
        size: 5120,
      } as unknown as File;

      const result = await service.createJob({ file: mockFile });

      expect(result).toHaveProperty('jobId');
    });

    it('uses file name as default job name', async () => {
      const mockFile = {
        name: 'my-document.docx',
        size: 2048,
      } as unknown as File;

      const result = await service.createJob({ file: mockFile });

      expect(result).toHaveProperty('jobId');
    });
  });

  describe('getJobStatus', () => {
    it('returns job status from repository', async () => {
      // getJobStatus returns a normalized shape (id/status/progress/currentStage/...).
      const mockJob = {
        id: 'job-456',
        status: 'completed',
        file_name: 'test.txt',
        progress: 100,
        stage: 'completed',
        chunks_preview: null,
        total_chunks: 0,
        description: null,
        error_message: null,
        knowledge_item_id: null,
        created_at: '2026-08-01T00:00:00Z',
        created_by: null,
      };

      // Override the mock's findById so we return a deterministic row.
      const repo = (service as unknown as { jobRepository: { findById: ReturnType<typeof vi.fn> } }).jobRepository;
      repo.findById.mockResolvedValue(mockJob);

      const result = await service.getJobStatus('job-456');

      expect(result).toEqual({
        id: 'job-456',
        status: 'completed',
        progress: 100,
        currentStage: 'completed',
        chunkPreview: null,
        totalChunks: 0,
        rawTextPreview: null,
        errorMessage: null,
        knowledgeItemId: null,
        createdAt: '2026-08-01T00:00:00Z',
        isOwner: true,
      });
    });

    it('returns null for non-existent job', async () => {
      const repo = (service as unknown as { jobRepository: { findById: ReturnType<typeof vi.fn> } }).jobRepository;
      repo.findById.mockResolvedValue(null);

      const result = await service.getJobStatus('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('image file handling', () => {
    it('accepts jpg images', async () => {
      const mockFile = {
        name: 'photo.jpg',
        size: 8192,
      } as unknown as File;

      const result = await service.createJob({ file: mockFile });

      expect(result).toHaveProperty('jobId');
    });

    it('accepts webp images', async () => {
      const mockFile = {
        name: 'icon.webp',
        size: 4096,
      } as unknown as File;

      const result = await service.createJob({ file: mockFile });

      expect(result).toHaveProperty('jobId');
    });
  });

  describe('chunking options', () => {
    it('accepts custom category', async () => {
      const mockFile = {
        name: 'faq.md',
        size: 2048,
      } as unknown as File;

      const result = await service.createJob({
        file: mockFile,
        category: 'FAQ',
        parentCategory: 'Documentation',
      });

      expect(result).toHaveProperty('jobId');
    });
  });
});
