export class RepositoryError extends Error {
  readonly operation: string;
  readonly code?: string;

  constructor(operation: string, causeMessage: string, code?: string) {
    super(`${operation}: ${causeMessage}`);
    this.name = 'RepositoryError';
    this.operation = operation;
    this.code = code;
  }
}
