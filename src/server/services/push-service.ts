import {
  PushRepository,
  type PushTemplate,
  type CreatePushTemplateInput,
  type UpdatePushTemplateInput,
  type PushRecord,
  type PushRecordFilters,
  type PushEventLog,
  type UpdateEventStatusInput,
} from '@/server/repositories/push-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class PushService {
  constructor(private readonly repo = new PushRepository()) {}

  async listTemplates(): Promise<{ templates: PushTemplate[] }> {
    try {
      const templates = await this.repo.listTemplates();
      return { templates };
    } catch (error) {
      throw toServiceError(error, '获取推送模板列表失败');
    }
  }

  async createTemplate(input: CreatePushTemplateInput): Promise<{ template: PushTemplate }> {
    if (!input.name || !input.trigger_event || !input.content_template) {
      throw new ServiceError('模板名称、触发事件和内容模板不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const template = await this.repo.createTemplate(input);
      return { template };
    } catch (error) {
      throw toServiceError(error, '创建推送模板失败');
    }
  }

  async updateTemplate(input: UpdatePushTemplateInput): Promise<{ template: PushTemplate }> {
    if (!input.id) {
      throw new ServiceError('模板ID不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const template = await this.repo.updateTemplate(input);
      return { template };
    } catch (error) {
      throw toServiceError(error, '更新推送模板失败');
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!id) {
      throw new ServiceError('模板ID不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      await this.repo.deleteTemplate(id);
    } catch (error) {
      throw toServiceError(error, '删除推送模板失败');
    }
  }

  async listRecords(
    filters: PushRecordFilters,
  ): Promise<{ records: PushRecord[]; total: number | null }> {
    try {
      const result = await this.repo.listRecords(filters);
      return { records: result.records, total: result.total };
    } catch (error) {
      throw toServiceError(error, '获取推送记录失败');
    }
  }

  async getEventLog(): Promise<{ events: PushEventLog[]; webhook_secret: string }> {
    try {
      const [events, webhookSecret] = await Promise.all([
        this.repo.listEventLogs({ limit: 20 }),
        this.repo.getWebhookSecret(),
      ]);
      return { events, webhook_secret: webhookSecret };
    } catch (error) {
      throw toServiceError(error, '获取事件日志失败');
    }
  }

  async updateEventStatus(input: UpdateEventStatusInput): Promise<{ event: PushEventLog }> {
    if (!input.id || !input.status) {
      throw new ServiceError('事件ID和状态不能为空', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      const event = await this.repo.updateEventStatus(input);
      return { event };
    } catch (error) {
      throw toServiceError(error, '更新事件状态失败');
    }
  }
}
