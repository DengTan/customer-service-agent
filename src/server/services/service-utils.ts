import { RepositoryError } from '@/server/repositories/repository-error';
import { ServiceError } from './service-error';

export function toServiceError(
  error: unknown,
  userMessage: string,
  code = 'DB_ERROR',
): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof RepositoryError) {
    return new ServiceError(userMessage, {
      status: 500,
      code,
      internalMessage: error.message,
    });
  }

  const internalMessage = error instanceof Error ? error.message : String(error);
  return new ServiceError(userMessage, {
    status: 500,
    code,
    internalMessage,
  });
}
