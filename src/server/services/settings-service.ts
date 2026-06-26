import { SettingsRepository } from '@/server/repositories/settings-repository';
import { ServiceError } from './service-error';
import { toServiceError } from './service-utils';

export class SettingsService {
  constructor(private readonly settings = new SettingsRepository()) {}

  async getSettingsMap(): Promise<Record<string, string>> {
    try {
      const rows = await this.settings.list();
      return rows.reduce<Record<string, string>>((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});
    } catch (error) {
      throw toServiceError(error, 'Failed to fetch settings');
    }
  }

  async updateSettings(settings: Record<string, string> | undefined): Promise<void> {
    if (!settings || typeof settings !== 'object') {
      throw new ServiceError('Invalid settings payload', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      await this.settings.upsertMany(settings);
    } catch (error) {
      throw toServiceError(error, 'Failed to update settings');
    }
  }
}
