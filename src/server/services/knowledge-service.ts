import { logger } from '@/lib/logger';
import {
  KnowledgeRepository,
  type UpdateKnowledgeItemInput,
  type CreateVersionInput,
  type RollbackInput,
  type VersionWithCreator,
} from '@/server/repositories/knowledge-repository';
import { knowledgeChunkRepository } from '@/server/repositories/knowledge-chunk-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';
import { diffChunks, summarizeDiff } from './text-chunker';
import { smartChunkText } from './smart-chunking-service';
import { createHash } from 'node:crypto';
import { deleteStorageFile, deleteStorageFiles } from '@/lib/storage-cleanup';
import { HTTP } from '@/lib/constants';

export interface KnowledgeItemsResult {
  items: unknown[];
  categories: Record<string, number>;
  categoryTree: Record<string, { count: number; children: Record<string, number> }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class KnowledgeService {
  constructor(private readonly knowledge = new KnowledgeRepository()) {}

  async listItems(options: {
    includeArchived?: boolean;
    onlyArchived?: boolean;
    includeExpired?: boolean;
    search?: string;
    status?: string;
    category?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<KnowledgeItemsResult> {
    const page = Math.max(1, options.page ?? 1);
    const rawLimit = options.limit ?? 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const filters = {
      ...(options.search ? { search: options.search } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.category ? { category: options.category } : {}),
    };
    const repoOptions = {
      includeArchived: options.includeArchived,
      onlyArchived: options.onlyArchived,
      includeExpired: options.includeExpired,
    };

    try {
      const [items, total, aggregation] = await Promise.all([
        this.knowledge.listItemsPage(filters, repoOptions, offset, limit),
        this.knowledge.countItems(filters, repoOptions),
        this.knowledge.aggregateCategories(filters, repoOptions),
      ]);
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      return {
        items,
        categories: aggregation.categories,
        categoryTree: aggregation.categoryTree,
        total,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      throw toServiceError(error, '获取知识条目失败', 'DB_QUERY_ERROR');
    }
  }

  async listAllIds(options: {
    includeArchived?: boolean;
    onlyArchived?: boolean;
    includeExpired?: boolean;
    search?: string;
    status?: string;
    category?: string;
  } = {}): Promise<{ ids: string[] }> {
    const filters = {
      ...(options.search ? { search: options.search } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.category ? { category: options.category } : {}),
    };
    const repoOptions = {
      includeArchived: options.includeArchived,
      onlyArchived: options.onlyArchived,
      includeExpired: options.includeExpired,
    };

    try {
      const ids = await this.knowledge.listAllIds(filters, repoOptions);
      // P0-3: 硬上限保护，避免大批量选取撑爆响应
      if (ids.length > HTTP.KNOWLEDGE_ALL_IDS_MAX) {
        throw new ServiceError(
          `筛选结果过多（>${HTTP.KNOWLEDGE_ALL_IDS_MAX}条），请缩小筛选范围后重试`,
          { status: 400, code: 'SELECT_LIMIT_EXCEEDED' },
        );
      }
      return { ids };
    } catch (error) {
      throw toServiceError(error, '获取知识条目ID失败', 'DB_QUERY_ERROR');
    }
  }

  async archiveItem(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('请提供条目ID', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      await this.knowledge.archiveItem(id);
    } catch (error) {
      throw toServiceError(error, '归档失败', 'DB_ERROR');
    }
  }

  async unarchiveItem(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('请提供条目ID', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      await this.knowledge.unarchiveItem(id);
    } catch (error) {
      throw toServiceError(error, '取消归档失败', 'DB_ERROR');
    }
  }

  async bulkArchive(ids: string[]): Promise<{ count: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError('请选择要归档的条目', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const count = await this.knowledge.bulkArchive(ids);
      return { count };
    } catch (error) {
      throw toServiceError(error, '批量归档失败', 'DB_ERROR');
    }
  }

  async bulkUnarchive(ids: string[]): Promise<{ count: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError('请选择要恢复的条目', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const count = await this.knowledge.bulkUnarchive(ids);
      return { count };
    } catch (error) {
      throw toServiceError(error, '批量恢复失败', 'DB_ERROR');
    }
  }

  async bulkUpdateCategory(input: { ids: string[]; category: string; parent_category?: string | null }): Promise<{ count: number }> {
    if (!Array.isArray(input.ids) || input.ids.length === 0) {
      throw new ServiceError('请选择要修改的条目', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (!input.category || !input.category.trim()) {
      throw new ServiceError('分类不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const count = await this.knowledge.bulkUpdateCategory(input.ids, input.category.trim(), input.parent_category);
      return { count };
    } catch (error) {
      throw toServiceError(error, '批量修改分类失败', 'DB_ERROR');
    }
  }

  async bulkDelete(ids: string[]): Promise<{ count: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError('请选择要删除的条目', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      // Batch fetch items to collect image_urls before deletion
      const items = await this.knowledge.findItemsByIds(ids);
      const imageUrls = items
        .map(item => (item as { image_url?: string | null }).image_url)
        .filter((url): url is string => !!url);

      // Fire-and-forget: delete storage files without blocking
      if (imageUrls.length > 0) {
        deleteStorageFiles(imageUrls);
      }

      const count = await this.knowledge.bulkDelete(ids);
      return { count };
    } catch (error) {
      throw toServiceError(error, '批量删除失败', 'DB_ERROR');
    }
  }

  async mergeCategory(input: { from: string; to: string; to_parent_category?: string | null }): Promise<{ count: number }> {
    if (!input.from || !input.to) {
      throw new ServiceError('请提供源分类与目标分类', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (input.from === input.to) {
      throw new ServiceError('源分类与目标分类不能相同', { status: 400, code: 'VALIDATION_ERROR' });
    }
    try {
      const count = await this.knowledge.mergeCategory(input.from, input.to, input.to_parent_category);
      return { count };
    } catch (error) {
      throw toServiceError(error, '合并分类失败', 'DB_ERROR');
    }
  }

  async listAllCategories(): Promise<{ categories: Array<{ category: string; parent_category: string | null; count: number }> }> {
    try {
      const categories = await this.knowledge.listAllCategories();
      return { categories };
    } catch (error) {
      throw toServiceError(error, '获取分类列表失败', 'DB_QUERY_ERROR');
    }
  }

  async updateItem(input: UpdateKnowledgeItemInput & { existingItem?: { doc_ids?: string[]; chunk_count?: number } }): Promise<{ message: string }> {
    if (!input.id) {
      throw new ServiceError('请提供条目ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const existingItem = await this.knowledge.findItemById(input.id);
      if (!existingItem) {
        throw new ServiceError('条目不存在', {
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      if (input.content !== undefined && existingItem.type === 'text') {
        return { message: '内容已更新（向量更新由路由层处理）' };
      }

      const updateData: UpdateKnowledgeItemInput = { id: input.id };
      if (input.name) updateData.name = input.name;
      if (input.category !== undefined) updateData.category = input.category;
      if (input.parent_category !== undefined) updateData.parent_category = input.parent_category;
      if (input.image_url !== undefined) updateData.image_url = input.image_url;
      if (input.expires_at !== undefined) updateData.expires_at = input.expires_at;
      if (input.archived_at !== undefined) updateData.archived_at = input.archived_at;

      await this.knowledge.updateItem(updateData);

      return { message: '条目已更新' };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '更新知识条目失败', 'DB_ERROR');
    }
  }

  async updateItemWithVector(input: {
    id: string;
    name?: string;
    content: string;
    category?: string;
  }): Promise<{ message: string }> {
    const existingItem = await this.knowledge.findItemById(input.id);
    if (!existingItem) {
      throw new ServiceError('条目不存在', {
        status: 404,
        code: 'NOT_FOUND',
      });
    }

    // 使用智能分段（LLM 自动分段，回退到规则分段）
    const newChunks = await smartChunkText(input.content, {
      chunkSize: 500,
      overlap: 50,
      enableLLMChunking: true,
    });

    // 获取当前版本号（用于 chunk version_added）
    const currentVersion = await this.knowledge.getLatestVersion(input.id);
    const nextVersion = currentVersion + 1;

    // 更新 knowledge_items 放在最前，先确保 item 更新成功，再写 chunks
    await this.knowledge.updateItem({
      id: input.id,
      name: input.name,
      content: input.content,
      category: input.category,
      chunk_count: newChunks.length,
    });

    // item 更新成功后，操作 chunks（即使失败，item 数据已是正确的）
    try {
      const oldChunks = await knowledgeChunkRepository.getActiveChunks(input.id);
      if (oldChunks.length > 0) {
        await knowledgeChunkRepository.markActiveChunksRemoved(input.id, nextVersion);
      }
      if (newChunks.length > 0) {
        await knowledgeChunkRepository.insertChunks(
          newChunks.map(c => ({
            knowledge_item_id: input.id,
            chunk_index: c.index,
            content: c.content,
            content_hash: c.content_hash,
            version_added: nextVersion,
          })),
        );
      }
    } catch (chunkError) {
      // chunks 写入失败不影响 item 已是正确的状态，仅记录日志
      logger.error('updateItemWithVector chunks 写入失败', { itemId: input.id, error: chunkError });
    }

    return { message: '内容已更新，向量索引已重建' };
  }

  async deleteItem(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('请提供条目ID', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      // Fetch item to get image_url before deletion
      const item = await this.knowledge.findItemById(id);
      if (item?.image_url) {
        // Fire-and-forget: delete storage file without blocking
        deleteStorageFile(item.image_url);
      }

      await this.knowledge.deleteItem(id);
    } catch (error) {
      throw toServiceError(error, '删除知识条目失败', 'DB_ERROR');
    }
  }

  async listVersions(itemId: string): Promise<{ versions: VersionWithCreator[] }> {
    if (!itemId) {
      throw new ServiceError('知识条目ID不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const versions = await this.knowledge.listVersions({ item_id: itemId });
      return { versions };
    } catch (error) {
      throw toServiceError(error, '获取版本历史失败', 'DB_QUERY_ERROR');
    }
  }

  async createVersion(input: CreateVersionInput): Promise<unknown> {
    if (!input.item_id || !input.title || !input.content) {
      throw new ServiceError('知识条目ID、标题和内容不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      // 1) 使用智能分段切分新旧内容为 chunks
      const newChunks = await smartChunkText(input.content, {
        chunkSize: 500,
        overlap: 50,
        enableLLMChunking: true,
      });
      const oldChunks = await knowledgeChunkRepository.getActiveChunks(input.item_id);

      // 2) 计算 chunk diff（在版本号确定前）
      // KnowledgeChunk 字段名是 chunk_index，map 成 index 形式
      const oldChunkDiffs = oldChunks.map(c => ({ index: c.chunk_index, content_hash: c.content_hash }));
      const diff = diffChunks(oldChunkDiffs, newChunks);
      const summary = summarizeDiff(diff, newChunks.length);

      // 3) 写新版本（repo 内部计算 nextVersion）
      const version = await this.knowledge.createVersion({
        ...input,
        chunk_diff: diff,
        chunk_count: summary.total_after,
      } as CreateVersionInput);
      // P0-2: repository .select() 字段是 version，不是 version_number
      const nextVersion = (version as { version: number }).version;

      // 4) 把旧 chunks 标为已移除
      if (oldChunks.length > 0) {
        await knowledgeChunkRepository.markActiveChunksRemoved(input.item_id, nextVersion);
      }

      // 5) 写入新 chunks
      if (newChunks.length > 0) {
        await knowledgeChunkRepository.insertChunks(
          newChunks.map(c => ({
            knowledge_item_id: input.item_id,
            chunk_index: c.index,
            content: c.content,
            content_hash: c.content_hash,
            version_added: nextVersion,
          })),
        );
      }

      // 6) 更新 knowledge_items.content 和 chunk_count
      await this.knowledge.updateKnowledgeItemContent(
        input.item_id,
        input.title,
        input.content,
        summary.total_after,
      );

      return version;
    } catch (error) {
      throw toServiceError(error, '创建版本失败', 'DB_ERROR');
    }
  }

  async rollbackToVersion(input: RollbackInput): Promise<{ version: unknown }> {
    if (!input.version_id) {
      throw new ServiceError('版本ID不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      // 先获取目标版本的内容
      const targetVersion = await this.knowledge.findVersionById(input.version_id);
      if (!targetVersion) {
        throw new ServiceError('版本不存在', { status: 404, code: 'NOT_FOUND' });
      }

      // 通过 createVersion 复用 chunk diff 跟踪逻辑
      // createVersion 会自动计算 diff 并写入 chunk 记录
      const version = await this.createVersion({
        item_id: targetVersion.knowledge_item_id,
        title: targetVersion.title,
        content: targetVersion.content,
        change_summary: `回滚至版本 v${targetVersion.version}`,
        created_by: input.created_by,
      });
      return { version };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw toServiceError(error, '回滚失败', 'DB_ERROR');
    }
  }
}
