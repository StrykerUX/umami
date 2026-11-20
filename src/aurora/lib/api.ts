import { parseRequest } from '@/lib/request';
import { json } from '@/lib/response';
import { type AuroraContext, requireAurora } from './access';
import type { AuroraRole } from './constants';

type Ok<T> = { ctx: AuroraContext; body: T; query: T; auth: any; error?: undefined };
type Err = {
  error: Response;
  ctx?: undefined;
  body?: undefined;
  query?: undefined;
  auth?: undefined;
};

/** parseRequest + Aurora role check in one call. */
export async function auroraRequest<T = any>(
  request: Request,
  schema?: any,
  minimum: AuroraRole = 'viewer',
): Promise<Ok<T> | Err> {
  const { auth, body, query, error } = await parseRequest(request, schema);

  if (error) {
    return { error: error() };
  }

  const result = await requireAurora(auth, minimum);

  if (result.error) {
    return { error: result.error };
  }

  return { ctx: result.ctx, body, query, auth };
}

export function errorJson(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, status } }, { status });
}

export { json };
