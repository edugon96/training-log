export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export function demand(condition: unknown, status: number, code: string, message: string, details?: unknown): asserts condition {
  if (!condition) throw new HttpError(status, code, message, details);
}
