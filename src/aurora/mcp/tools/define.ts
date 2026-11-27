import type { ToolDefinition } from '@umami/mcp';
import type { z } from 'zod';

/** Identity helper that keeps the input schema type for the handler. */
export function defineAuroraTool<Schema extends z.ZodObject<z.ZodRawShape>>(
  definition: ToolDefinition<Schema>,
): ToolDefinition<Schema> {
  return definition;
}

export const DAYS_DESCRIPTION =
  'Window length in days (default 30). Compared against the previous window of the same length.';

export function iso(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function pick<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]) {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = obj[key];
  return out;
}
