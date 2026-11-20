import { z } from 'zod';
import { errorJson, json } from '@/aurora/lib/api';
import { resetPassword } from '@/aurora/lib/password';
import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { getJsonBody } from '@/lib/request';

const schema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(255),
});

export async function POST(request: Request) {
  if (!rateLimit(`reset:${clientIp(request)}`, 10, 15 * 60000)) {
    return errorJson(429, 'rate-limited', 'Demasiados intentos. Intenta más tarde.');
  }

  const parsed = schema.safeParse(await getJsonBody(request));

  if (!parsed.success) {
    return errorJson(400, 'bad-request', 'La contraseña debe tener al menos 8 caracteres.');
  }

  if (!(await resetPassword(parsed.data.token, parsed.data.password))) {
    return errorJson(400, 'invalid-token', 'El link no es válido o ya venció.');
  }

  return json({ ok: true });
}
