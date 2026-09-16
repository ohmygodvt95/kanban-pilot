import type { ValidationTargets } from 'hono';
import { validator } from 'hono/validator';
import type { z } from 'zod';
import { errorBody } from './errors.js';

/** zod-based request validator returning the shared `{ error }` shape on failure. */
export function zValidator<T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return validator(target, (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return c.json(errorBody('VALIDATION', 'invalid request', result.error.issues), 400);
    }
    return result.data as z.infer<T>;
  });
}
