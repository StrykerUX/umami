import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token with a readable prefix. Only its hash is stored. */
export function generateToken(prefix = 'au') {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);

  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
