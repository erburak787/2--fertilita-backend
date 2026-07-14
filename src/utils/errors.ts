export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_SERVER_ERROR'
  | 'NOT_IMPLEMENTED';

export class ApiError extends Error {
  public readonly code: ErrorCode;

  constructor({ code, message }: { code: ErrorCode; message: string }) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }

  getStatusCode(): number {
    switch (this.code) {
      case 'BAD_REQUEST': return 400;
      case 'UNAUTHORIZED': return 401;
      case 'FORBIDDEN': return 403;
      case 'NOT_FOUND': return 404;
      case 'CONFLICT': return 409;
      case 'UNPROCESSABLE_ENTITY': return 422;
      case 'TOO_MANY_REQUESTS': return 429;
      case 'INTERNAL_SERVER_ERROR': return 500;
      case 'NOT_IMPLEMENTED': return 501;
      default: return 500;
    }
  }
}
