import { errorJson, json } from '@/aurora/lib/api';
import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { parseReportLinkToken } from '@/aurora/lib/report';
import prisma from '@/lib/prisma';

/** Public: a report run's snapshot, authorized by a signed, expiring link token. */
export async function GET(request: Request) {
  if (!rateLimit(`public-report:${clientIp(request)}`, 60, 60000)) {
    return errorJson(429, 'rate-limited', 'Demasiadas solicitudes.');
  }

  const token = new URL(request.url).searchParams.get('token') ?? '';
  const runId = token ? parseReportLinkToken(token) : null;

  if (!runId) {
    return errorJson(404, 'invalid-link', 'El link del reporte no es válido o ya venció.');
  }

  const run = await prisma.client.auroraReportRun.findUnique({ where: { id: runId } });

  if (!run || run.status === 'error') {
    return errorJson(404, 'not-found', 'Reporte no disponible.');
  }

  return json({ snapshot: run.snapshot, createdAt: run.createdAt });
}
