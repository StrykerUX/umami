import { healthTokenMatches, httpStatusFor, runHealthChecks } from '@/aurora/lib/health';

export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'no-store' };

/**
 * Aurora Status healthcheck (https://status.aurora33.org/healthcheck).
 * Public: overall status only. With `Bearer AURORA_HEALTH_TOKEN`: per-check detail.
 * A missing or wrong token gets the public shape (never 401). No session, no writes.
 * The platform healthcheck stays on /api/heartbeat.
 */
export async function GET(request: Request) {
  const report = await runHealthChecks();
  const status = httpStatusFor(report.status);
  const body = healthTokenMatches(request) ? report : { status: report.status };

  return Response.json(body, { status, headers: HEADERS });
}
