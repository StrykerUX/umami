import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));

import { monitorTargetUrl, nextMonitorState } from '../lib/uptime';

describe('nextMonitorState', () => {
  test('one failure is not enough to go down', () => {
    expect(nextMonitorState({ status: 'up', consecutiveFailures: 0 }, false)).toEqual({
      status: 'up',
      consecutiveFailures: 1,
      transition: null,
    });
  });

  test('two consecutive failures go down once', () => {
    const s1 = nextMonitorState({ status: 'up', consecutiveFailures: 1 }, false);
    expect(s1).toEqual({ status: 'down', consecutiveFailures: 2, transition: 'went_down' });
    const s2 = nextMonitorState(s1, false);
    expect(s2.transition).toBeNull();
    expect(s2.status).toBe('down');
  });

  test('success after down recovers', () => {
    expect(nextMonitorState({ status: 'down', consecutiveFailures: 5 }, true)).toEqual({
      status: 'up',
      consecutiveFailures: 0,
      transition: 'recovered',
    });
  });

  test('unknown monitors become up without a transition', () => {
    expect(
      nextMonitorState({ status: 'unknown', consecutiveFailures: 0 }, true).transition,
    ).toBeNull();
  });
});

test('monitorTargetUrl', () => {
  expect(monitorTargetUrl('example.com')).toBe('https://example.com');
  expect(monitorTargetUrl('http://a.com')).toBe('http://a.com');
  expect(monitorTargetUrl('  ')).toBeNull();
  expect(monitorTargetUrl(null)).toBeNull();
});
