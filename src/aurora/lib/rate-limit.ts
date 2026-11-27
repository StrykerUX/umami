const buckets = new Map<string, number[]>();
const MAX_KEYS = 10000;

/** Small in-process sliding-window limiter for public, unauthenticated endpoints. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }

  hits.push(now);
  // Re-insert so Map order tracks recency, then evict the least recently used keys. O(1) per call,
  // bounded memory even if callers rotate spoofed IPs.
  buckets.delete(key);
  buckets.set(key, hits);

  while (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }

  return true;
}

export function clientIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function resetRateLimits() {
  buckets.clear();
}
