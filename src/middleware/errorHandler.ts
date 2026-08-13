// Consistent error response shape across the whole API:
// { error: { code, message, details? } }
//
// Every thrown error must pass through here so clients always
// get the same structure regardless of where it originated.

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Zod validation failure → 400
  if (err instanceof ZodError) {
    const flat = err.flatten();
    const details = Object.entries(flat.fieldErrors).map(([field, messages]) => ({
      field,
      message: (messages as string[])[0] ?? 'Invalid',
    }));
    res.status(400).json({
      error: { code: 'INVALID_INPUT', message: 'Validation failed', details },
    });
    return;
  }

  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // PostgreSQL unique violation (e.g. duplicate idempotency key race)
  if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'Resource already exists' },
    });
    return;
  }

  // Unexpected errors — log and return generic 500
  console.error('[Unhandled error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
