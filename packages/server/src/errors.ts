import { CoreError } from '@agent-kanban/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export function handleError(err: unknown, c: Context) {
  if (err instanceof CoreError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status as 400);
  }
  if (err instanceof ZodError) {
    return c.json(errorBody('VALIDATION', 'invalid request body', err.issues), 400);
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody('HTTP_ERROR', err.message), err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json(errorBody('INTERNAL', message), 500);
}
