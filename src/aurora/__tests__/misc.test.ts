import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));

import { getOrgRedirect } from '../components/nav';
import { escapeHtml } from '../emails/layout';
import { inviteEmail, resetEmail } from '../emails/templates';
import { checkServiceSecret, hasAuroraRole } from '../lib/access';
import { inviteStatus } from '../lib/invites';
import { teamRoleToAuroraRole } from '../lib/org';
import { clientIp, rateLimit, resetRateLimits } from '../lib/rate-limit';
import { reportScheduleSchema, uptimeResultsSchema } from '../lib/schemas';
import { slugify } from '../lib/slug';
import { generateToken, hashToken, normalizeEmail, safeEqual } from '../lib/tokens';

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimits();
});

describe('tokens', () => {
  test('tokens are random, prefixed, and hash deterministically', () => {
    const a = generateToken('inv');
    const b = generateToken('inv');
    expect(a).toMatch(/^inv_[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toHaveLength(64);
  });

  test('safeEqual and normalizeEmail', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(normalizeEmail('  Ana@Ejemplo.COM ')).toBe('ana@ejemplo.com');
  });
});

describe('roles', () => {
  test('rank ordering', () => {
    expect(hasAuroraRole('admin', 'editor')).toBe(true);
    expect(hasAuroraRole('editor', 'editor')).toBe(true);
    expect(hasAuroraRole('viewer', 'editor')).toBe(false);
  });

  test('maps umami roles to aurora roles', () => {
    expect(teamRoleToAuroraRole('admin', 'team-view-only')).toBe('admin');
    expect(teamRoleToAuroraRole('user', 'team-owner')).toBe('admin');
    expect(teamRoleToAuroraRole('user', 'team-manager')).toBe('admin');
    expect(teamRoleToAuroraRole('user', 'team-member')).toBe('editor');
    expect(teamRoleToAuroraRole('view-only', 'team-view-only')).toBe('viewer');
    expect(teamRoleToAuroraRole('user', 'team-view-only')).toBe('viewer');
  });
});

describe('service secret', () => {
  const req = (auth?: string) =>
    new Request('http://x', { headers: auth ? { authorization: auth } : {} });

  test('rejects when unset or too short', () => {
    expect(checkServiceSecret(req('Bearer whatever'))).toBe(false);
    vi.stubEnv('AURORA_CRON_SECRET', 'short');
    expect(checkServiceSecret(req('Bearer short'))).toBe(false);
  });

  test('accepts only the exact bearer secret', () => {
    vi.stubEnv('AURORA_CRON_SECRET', 'a-long-enough-secret-123');
    expect(checkServiceSecret(req('Bearer a-long-enough-secret-123'))).toBe(true);
    expect(checkServiceSecret(req('Bearer a-long-enough-secret-124'))).toBe(false);
    expect(checkServiceSecret(req('a-long-enough-secret-123'))).toBe(false);
    expect(checkServiceSecret(req())).toBe(false);
  });
});

test('inviteStatus', () => {
  const future = new Date(Date.now() + 1000);
  const past = new Date(Date.now() - 1000);
  expect(inviteStatus({ revokedAt: null, expiresAt: future, uses: 0, maxUses: 1 })).toBe('pending');
  expect(inviteStatus({ revokedAt: null, expiresAt: future, uses: 1, maxUses: 1 })).toBe(
    'accepted',
  );
  expect(inviteStatus({ revokedAt: null, expiresAt: past, uses: 0, maxUses: 1 })).toBe('expired');
  expect(inviteStatus({ revokedAt: past, expiresAt: future, uses: 0, maxUses: 1 })).toBe('revoked');
});

test('rate limit window', () => {
  expect(rateLimit('k', 2, 1000, 0)).toBe(true);
  expect(rateLimit('k', 2, 1000, 10)).toBe(true);
  expect(rateLimit('k', 2, 1000, 20)).toBe(false);
  expect(rateLimit('k', 2, 1000, 1500)).toBe(true);
  expect(
    clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })),
  ).toBe('1.2.3.4');
});

test('emails escape user content', () => {
  expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  const invite = inviteEmail({
    url: 'https://a/invite/t',
    role: 'editor',
    inviter: '<img src=x>',
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  });
  expect(invite.html).not.toContain('<img src=x>');
  expect(invite.html).toContain('Editor');
  expect(resetEmail({ url: 'https://a/reset/t', username: 'ana' }).html).toContain(
    'https://a/reset/t',
  );
});

test('slugify', () => {
  expect(slugify('Clientes Ñoños & Más')).toBe('clientes-nonos-mas');
  expect(slugify('!!!')).toBe('workspace');
});

describe('schemas', () => {
  test('report schedules need a target unless scope is all', () => {
    expect(
      reportScheduleSchema.safeParse({ name: 'a', scope: 'all', frequency: 'weekly' }).success,
    ).toBe(true);
    expect(
      reportScheduleSchema.safeParse({ name: 'a', scope: 'client', frequency: 'weekly' }).success,
    ).toBe(false);
    expect(
      reportScheduleSchema.safeParse({ name: 'a', scope: 'all', frequency: 'daily' }).success,
    ).toBe(false);
    expect(
      reportScheduleSchema.safeParse({
        name: 'a',
        scope: 'all',
        frequency: 'weekly',
        timezone: 'Mars/Base',
      }).success,
    ).toBe(false);
  });

  test('uptime payload validation', () => {
    expect(
      uptimeResultsSchema.safeParse({
        results: [
          {
            websiteId: '9b27b8ed-d01f-4a51-acaf-7b68f333431e',
            checkedAt: new Date().toISOString(),
            ok: true,
          },
        ],
      }).success,
    ).toBe(true);
    expect(uptimeResultsSchema.safeParse({ results: [{ websiteId: 'x', ok: true }] }).success).toBe(
      false,
    );
  });
});

describe('getOrgRedirect', () => {
  const org = '11111111-2222-3333-4444-555555555555';

  test('moves org pages into the team context', () => {
    expect(getOrgRedirect('/websites', '', org)).toBe(`/teams/${org}/websites`);
    expect(getOrgRedirect('/websites/abc', 'date=7d', org)).toBe(
      `/teams/${org}/websites/abc?date=7d`,
    );
    expect(getOrgRedirect('/aurora/reports', '', org)).toBe(`/teams/${org}/aurora/reports`);
    expect(getOrgRedirect('/dashboard', '', org)).toBe(`/teams/${org}/aurora/overview`);
  });

  test('leaves settings, admin and team pages alone', () => {
    expect(getOrgRedirect('/settings/profile', '', org)).toBeNull();
    expect(getOrgRedirect('/admin/users', '', org)).toBeNull();
    expect(getOrgRedirect(`/teams/${org}/websites`, '', org)).toBeNull();
    expect(getOrgRedirect('/websites', '', null)).toBeNull();
  });
});
