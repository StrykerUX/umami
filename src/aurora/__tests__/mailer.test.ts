import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/prisma', () => ({
  default: { client: { auroraEmailLog: { create: (...a: any[]) => create(...a) } } },
}));

import { getMailDriver, sendMail } from '../lib/mailer';

beforeEach(() => {
  create.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const msg = { kind: 'test', to: ['A@x.com', 'a@x.com ', ''], subject: 'Hola', html: '<p>x</p>' };

describe('mailer', () => {
  test('outbox driver without RESEND_API_KEY stores the body', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    expect(getMailDriver()).toBe('outbox');
    const result = await sendMail(msg);
    expect(result.status).toBe('outbox');
    expect(create.mock.calls[0][0].data).toMatchObject({
      kind: 'test',
      status: 'outbox',
      html: '<p>x</p>',
    });
  });

  test('resend driver posts to the API and drops the body from the log', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('MAIL_FROM', 'Aurora <analytics@aurora33.org>');
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'email_123' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail(msg);

    expect(result).toMatchObject({ status: 'sent', providerId: 'email_123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Aurora <analytics@aurora33.org>');
    expect(body.to).toEqual(['A@x.com', 'a@x.com']);
    expect(create.mock.calls[0][0].data.html).toBeNull();
  });

  test('provider errors are recorded, not thrown', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ message: 'domain not verified' }),
      }),
    );

    const result = await sendMail(msg);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('domain not verified');
    expect(create.mock.calls[0][0].data.status).toBe('failed');
  });

  test('no recipients is a failure without a provider call', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await sendMail({ ...msg, to: [' '] })).status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
