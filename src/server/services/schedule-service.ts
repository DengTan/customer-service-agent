import {
  ScheduleRepository,
  type ScheduleFilters,
  type ScheduleItem,
} from '@/server/repositories/schedule-repository';
import { toServiceError } from './service-utils';

const VALID_SHIFTS = ['morning', 'afternoon', 'evening'];

export class ScheduleService {
  constructor(private readonly repo = new ScheduleRepository()) {}

  async listSchedules(filters: ScheduleFilters = {}) {
    try {
      return await this.repo.list(filters);
    } catch (error) {
      throw toServiceError(error, '获取排班列表失败', 'DB_ERROR');
    }
  }

  async createSchedules(items: ScheduleItem[]) {
    if (!items || items.length === 0) {
      throw toServiceError(
        new Error('validation'),
        '排班数据不能为空',
        'VALIDATION_ERROR'
      );
    }

    for (const item of items) {
      if (!VALID_SHIFTS.includes(item.shift)) {
        throw toServiceError(
          new Error('validation'),
          `无效的班次: ${item.shift}`,
          'VALIDATION_ERROR'
        );
      }
    }

    try {
      return await this.repo.upsert(items);
    } catch (error) {
      throw toServiceError(error, '创建排班失败', 'DB_ERROR');
    }
  }

  async deleteSchedule(id: string) {
    if (!id) {
      throw toServiceError(
        new Error('validation'),
        '缺少排班ID',
        'VALIDATION_ERROR'
      );
    }

    try {
      await this.repo.delete(id);
    } catch (error) {
      throw toServiceError(error, '删除排班失败', 'DB_ERROR');
    }
  }
}
