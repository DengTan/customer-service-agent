import {
  SkillGroupRepository,
  type SkillGroupFilters,
  type CreateSkillGroupInput,
  type UpdateSkillGroupInput,
} from '@/server/repositories/skill-group-repository';
import { toServiceError } from './service-utils';

export class SkillGroupService {
  constructor(private readonly repo = new SkillGroupRepository()) {}

  async listGroups(_filters: SkillGroupFilters = {}) {
    try {
      return await this.repo.list();
    } catch (error) {
      throw toServiceError(error, '获取技能组列表失败', 'DB_ERROR');
    }
  }

  async createGroup(input: CreateSkillGroupInput) {
    if (!input.name) {
      throw toServiceError(
        new Error('validation'),
        '技能组名称不能为空',
        'VALIDATION_ERROR'
      );
    }

    try {
      return await this.repo.create(input);
    } catch (error) {
      const errorObj = error as { code?: string };
      if (errorObj.code === '23505') {
        throw toServiceError(
          new Error('duplicate'),
          '技能组名称已存在',
          'CONFLICT'
        );
      }
      throw toServiceError(error, '创建技能组失败', 'DB_ERROR');
    }
  }

  async updateGroup(input: UpdateSkillGroupInput) {
    if (!input.id) {
      throw toServiceError(
        new Error('validation'),
        '缺少技能组ID',
        'VALIDATION_ERROR'
      );
    }

    try {
      return await this.repo.update(input);
    } catch (error) {
      throw toServiceError(error, '更新技能组失败', 'DB_ERROR');
    }
  }

  async deleteGroup(id: string) {
    if (!id) {
      throw toServiceError(
        new Error('validation'),
        '缺少技能组ID',
        'VALIDATION_ERROR'
      );
    }

    try {
      await this.repo.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除技能组失败', 'DB_ERROR');
    }
  }
}
