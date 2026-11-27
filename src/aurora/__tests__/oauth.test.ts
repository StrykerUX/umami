import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp/auth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    ok: false,
    status: 401,
    error: 'invalid_request',
    description: 'Missing bearer API key.',
  })),
}));

import { rateLimit, resetRateLimits } from '../lib/rate-limit';
import {
  getAllowedRedirectUris,
  getIssuer,
  getMcpResource,
  isOAuthEnabled,
  normalizeResource,
} from '../oauth/config';
import {
  auroraMcpUnauthorized,
  authenticateAuroraMcp,
  withoutCredentialEcho,
} from '../oauth/mcp-auth';
import { authorizationServerMetadata, protectedResourceMetadata } from '../oauth/metadata';
import {
  appendRedirectParams,
  computeCodeChallenge,
  isAcceptableRedirectUri,
  isValidCodeChallenge,
  OAuthError,
  oauthErrorResponse,
  readOAuthBody,
  redirectUriMatches,
  verifyPkce,
} from '../oauth/primitives';

const env = { ...process.env };

afterEach(() => {
  process.env = { ...env };
});

const VERIFIER = `${'a'.repeat(43)}-._~0123456789`;

describe('OAuth config', () => {
  it('issuer comes only from APP_URL / AURORA_OAUTH_ISSUER (https, or http on localhost)', () => {
    expect(getIssuer({ APP_URL: 'https://analytics.aurora33.dev/' } as any)).toBe(
      'https://analytics.aurora33.dev',
    );
    expect(
      getIssuer({
        APP_URL: 'https://a.example',
        AURORA_OAUTH_ISSUER: 'https://b.example',
      } as any),
    ).toBe('https://b.example');
    expect(getIssuer({ APP_URL: 'http://localhost:3400' } as any)).toBe('http://localhost:3400');
    expect(getIssuer({ APP_URL: 'http://analytics.aurora33.dev' } as any)).toBeNull();
    expect(getIssuer({ APP_URL: 'not a url' } as any)).toBeNull();
    expect(getIssuer({} as any)).toBeNull();
  });

  it('is enabled only with MCP on, an issuer, and no kill switch', () => {
    const base = { MCP_ENABLED: '1', APP_URL: 'https://x.example' } as any;

    expect(isOAuthEnabled(base)).toBe(true);
    expect(isOAuthEnabled({ ...base, MCP_ENABLED: '0' })).toBe(false);
    expect(isOAuthEnabled({ ...base, AURORA_OAUTH_DISABLED: '1' })).toBe(false);
    expect(isOAuthEnabled({ ...base, CLOUD_MODE: '1' })).toBe(false);
    expect(isOAuthEnabled({ MCP_ENABLED: '1' } as any)).toBe(false);
  });

  it('normalizes resource indicators', () => {
    expect(getMcpResource('https://x.example/')).toBe('https://x.example/mcp');
    expect(normalizeResource('https://X.example/mcp/')).toBe('https://x.example/mcp');
    expect(normalizeResource('https://x.example/mcp#frag')).toBeNull();
    expect(normalizeResource('https://x.example/mcp?a=1')).toBeNull();
    expect(normalizeResource('nope')).toBeNull();
  });

  it('redirect allowlist is exact URIs (Claude callbacks by default)', () => {
    expect(getAllowedRedirectUris({} as any)).toEqual([
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
    ]);
    expect(
      getAllowedRedirectUris({
        AURORA_OAUTH_REDIRECT_URIS: 'https://a.example/cb, http://b.example/cb, nope',
      } as any),
    ).toEqual(['https://a.example/cb']);
  });
});

describe('PKCE', () => {
  it('accepts only S256 with a valid verifier, in constant time', () => {
    const challenge = computeCodeChallenge(VERIFIER);

    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(isValidCodeChallenge('short')).toBe(false);
    expect(verifyPkce(VERIFIER, challenge)).toBe(true);
    expect(verifyPkce(`${VERIFIER}x`, challenge)).toBe(false);
    expect(verifyPkce('too-short', computeCodeChallenge('too-short'))).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
  });
});

describe('redirect URIs', () => {
  it('allows loopback http and the exact allowlisted https URIs only', () => {
    const e = {} as any;

    for (const ok of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'http://127.0.0.1:53682/callback',
      'http://localhost:8080/cb',
    ]) {
      expect(isAcceptableRedirectUri(ok, e), ok).toBe(true);
    }

    for (const bad of [
      'https://claude.ai/other',
      'https://claude.ai/api/mcp/auth_callback/',
      'https://claude.ai/api/mcp/auth_callback?next=x',
      'https://claude.ai:443/api/mcp/auth_callback',
      'https://claude.ai:8443/api/mcp/auth_callback',
      'https://CLAUDE.ai/api/mcp/auth_callback',
      'https://evil.example/api/mcp/auth_callback',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'myapp://callback',
      'javascript:alert(1)',
      'https://claude.ai/api/mcp/auth_callback#x',
      'https://user:pw@claude.ai/api/mcp/auth_callback',
    ]) {
      expect(isAcceptableRedirectUri(bad, e), bad).toBe(false);
    }
  });

  it('matches exactly, except loopback port', () => {
    expect(redirectUriMatches('https://claude.ai/cb', 'https://claude.ai/cb')).toBe(true);
    expect(redirectUriMatches('https://claude.ai/cb/', 'https://claude.ai/cb')).toBe(false);
    expect(redirectUriMatches('https://claude.ai/cb?x=1', 'https://claude.ai/cb')).toBe(false);
    expect(redirectUriMatches('http://127.0.0.1:5000/cb', 'http://127.0.0.1:4000/cb')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1:5000/other', 'http://127.0.0.1:4000/cb')).toBe(
      false,
    );
    expect(redirectUriMatches('http://localhost:5000/cb', 'http://127.0.0.1:4000/cb')).toBe(false);
  });

  it('appends params without dropping existing ones', () => {
    const url = new URL(
      appendRedirectParams('https://claude.ai/cb?x=1', { code: 'c', state: undefined, iss: 'i' }),
    );

    expect(url.searchParams.get('x')).toBe('1');
    expect(url.searchParams.get('code')).toBe('c');
    expect(url.searchParams.has('state')).toBe(false);
  });
});

describe('OAuth responses', () => {
  it('errors are JSON, no-store, 401 carries WWW-Authenticate', async () => {
    const res = oauthErrorResponse(new OAuthError('invalid_client', 'Unknown client_id.'));

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('www-authenticate')).toContain('invalid_client');
    expect(await res.json()).toEqual({
      error: 'invalid_client',
      error_description: 'Unknown client_id.',
    });

    const generic = oauthErrorResponse(new Error('db password=secret'));
    expect(generic.status).toBe(500);
    expect(JSON.stringify(await generic.json())).not.toContain('secret');
  });

  it('reads form and JSON bodies (first value wins)', async () => {
    const form = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=a&grant_type=b&code=c',
    });
    expect(await readOAuthBody(form)).toEqual({ grant_type: 'a', code: 'c' });

    const json = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[1,2]',
    });
    expect(await readOAuthBody(json)).toEqual({});
  });
});

describe('metadata', () => {
  it('advertises PKCE S256, public clients, DCR, and no metadata documents', () => {
    const as = authorizationServerMetadata('https://x.example');

    expect(as.issuer).toBe('https://x.example');
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(as.registration_endpoint).toBe('https://x.example/api/aurora/oauth/register');
    expect(as.client_id_metadata_document_supported).toBe(false);

    const pr = protectedResourceMetadata('https://x.example');
    expect(pr.resource).toBe('https://x.example/mcp');
    expect(pr.authorization_servers).toEqual(['https://x.example']);
  });
});

describe('MCP authentication', () => {
  it('401 points at the protected resource metadata when OAuth is enabled', async () => {
    process.env.MCP_ENABLED = '1';
    process.env.APP_URL = 'https://x.example';
    delete process.env.AURORA_OAUTH_DISABLED;

    const auth = await authenticateAuroraMcp(new Request('https://x.example/mcp'));
    expect(auth.ok).toBe(false);

    const res = auroraMcpUnauthorized(auth);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://x.example/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('rejects OAuth-shaped tokens when OAuth is disabled, without touching the database', async () => {
    process.env.MCP_ENABLED = '1';
    process.env.APP_URL = 'https://x.example';
    process.env.AURORA_OAUTH_DISABLED = '1';

    const auth = await authenticateAuroraMcp(
      new Request('https://x.example/mcp', { headers: { authorization: 'Bearer aat_whatever' } }),
    );

    expect(auth).toMatchObject({ ok: false, error: 'invalid_token' });
    expect(auroraMcpUnauthorized(auth).headers.get('www-authenticate')).not.toContain(
      'resource_metadata',
    );
  });
});

describe('credential echo guard', () => {
  it('strips tokens from /api/me and leaves other responses untouched', async () => {
    const inner = vi.fn(async (input: string | URL) =>
      Response.json(
        String(input).includes('/api/me')
          ? { token: 'secret', authKey: 'k', user: { id: 'u' } }
          : { token: 'keep' },
      ),
    );
    const guarded = withoutCredentialEcho(inner);

    expect(await (await guarded('http://x/api/me')).json()).toEqual({ user: { id: 'u' } });
    expect(await (await guarded('http://x/api/websites')).json()).toEqual({ token: 'keep' });
  });
});

describe('rate limiter', () => {
  it('limits per key and keeps memory bounded', () => {
    resetRateLimits();
    expect(rateLimit('k', 2, 1000, 0)).toBe(true);
    expect(rateLimit('k', 2, 1000, 1)).toBe(true);
    expect(rateLimit('k', 2, 1000, 2)).toBe(false);
    expect(rateLimit('k', 2, 1000, 2000)).toBe(true);

    for (let i = 0; i < 12000; i++) rateLimit(`ip-${i}`, 5, 60_000, 10);
    // Oldest keys were evicted; the newest still count.
    expect(rateLimit('ip-11999', 1, 60_000, 11)).toBe(false);
    resetRateLimits();
  });
});
