import { KnowledgeCategoryRepository, type KnowledgeCategory } from '@/server/repositories/knowledge-category-repository';
import { ServiceError } from './service-error';

export class KnowledgeCategoryService {
  constructor(private readonly repo = new KnowledgeCategoryRepository()) {}

  async create(input: {
    name: string;
    color?: string;
    description?: string;
  }): Promise<KnowledgeCategory> {
    if (!input.name?.trim()) {
      throw new ServiceError('分类名称不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    const existing = await this.repo.findByName(input.name.trim());
    if (existing) {
      throw new ServiceError('分类名称已存在', { status: 400, code: 'DUPLICATE_NAME' });
    }
    return this.repo.create({
      name: input.name.trim(),
      color: input.color,
      description: input.description,
    });
  }

  async get(id: string): Promise<KnowledgeCategory> {
    const category = await this.repo.findById(id);
    if (!category) {
      throw new ServiceError('分类不存在', { status: 404, code: 'NOT_FOUND' });
    }
    return category;
  }

  async update(id: string, input: {
    name?: string;
    color?: string;
    description?: string;
  }): Promise<KnowledgeCategory> {
    if (input.name !== undefined && !input.name.trim()) {
      throw new ServiceError('分类名称不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (input.name) {
      const existing = await this.repo.findByName(input.name.trim());
      if (existing && existing.id !== id) {
        throw new ServiceError('分类名称已存在', { status: 400, code: 'DUPLICATE_NAME' });
      }
    }
    return this.repo.update(id, {
      name: input.name?.trim(),
      color: input.color,
      description: input.description,
    });
  }

  async delete(id: string): Promise<{ affected_items: number }> {
    const category = await this.get(id);
    const affectedItems = category.item_count;
    await this.repo.delete(id);
    return { affected_items: affectedItems };
  }

  async list(): Promise<KnowledgeCategory[]> {
    return this.repo.list();
  }
}
