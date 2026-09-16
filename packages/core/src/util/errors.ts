export type CoreErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'CONFIRM_REQUIRED'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'GIT_ERROR'
  | 'EXECUTOR_ERROR'
  | 'INTERNAL';

export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CoreError';
  }

  /** HTTP status a transport should use for this error. */
  get status(): number {
    switch (this.code) {
      case 'NOT_FOUND':
        return 404;
      case 'INVALID_TRANSITION':
      case 'CONFIRM_REQUIRED':
      case 'CONFLICT':
        return 409;
      case 'VALIDATION':
        return 400;
      default:
        return 500;
    }
  }
}

export const notFound = (what: string, id: string) => new CoreError('NOT_FOUND', `${what} ${id} not found`);

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
