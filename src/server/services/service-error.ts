export class ServiceError extends Error {
  readonly userMessage: string;
  readonly status: number;
  readonly code?: string;

  constructor(
    userMessage: string,
    {
      status = 500,
      code,
      internalMessage,
    }: {
      status?: number;
      code?: string;
      internalMessage?: string;
    } = {},
  ) {
    super(internalMessage ?? userMessage);
    this.name = 'ServiceError';
    this.userMessage = userMessage;
    this.status = status;
    this.code = code;
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
