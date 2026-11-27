import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import middleware from '../../../docker/proxy';

const csp = (path: string) =>
  middleware(new NextRequest(`https://analytics.example${path}`)).headers.get(
    'content-security-policy',
  ) ?? '';

describe('docker proxy CSP (production)', () => {
  it("OAuth consent page gets frame-ancestors 'none'", () => {
    expect(csp('/oauth/authorize?client_id=x')).toContain("frame-ancestors 'none'");
    expect(csp('/oauth/authorize')).not.toContain("frame-ancestors 'self'");
  });

  it('other pages keep the default policy', () => {
    expect(csp('/login')).toContain("frame-ancestors 'self'");
  });
});
