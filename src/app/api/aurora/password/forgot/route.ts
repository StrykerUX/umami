import { z } from 'zod';
import { errorJson, json } from '@/aurora/lib/api';
import { requestPasswordReset } from '@/aurora/lib/password';
import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { getJsonBody } from '@/lib/request';

const schema = z.object({ identifier: z.string().trim().min(3).max(320) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await getJsonBody(request));

  if (!parsed.success) {
    return errorJson(400, 'bad-request', 'Escribe tu email o usuario.');
  }

  const ip = clientIp(request);

  if (
    !rateLimit(`forgot:${ip}`, 5, 15 * 60000) ||
    !rateLimit(`forgot-id:${parsed.data.identifier.toLowerCase()}`, 3, 15 * 60000)
  ) {
    return errorJson(429, 'rate-limited', 'Demasiados intentos. Intenta más tarde.');
  }

  await requestPasswordReset(parsed.data.identifier);

  // Same response whether the account exists or not.
  return json({ ok: true });
}
