import { z } from 'zod';
import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { getReportUrl, runSchedule } from '@/aurora/lib/report';
import prisma from '@/lib/prisma';

/** Runs a report now for the last completed period. `send: false` = preview only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const schema = z.object({ send: z.boolean().default(false) });
  const { body, error } = await auroraRequest<z.infer<typeof schema>>(request, schema, 'editor');

  if (error) {
    return error;
  }

  const { id } = await params;
  const schedule = await prisma.client.auroraReportSchedule.findUnique({ where: { id } });

  if (!schedule) {
    return errorJson(404, 'not-found', 'Reporte no encontrado.');
  }

  const result = await runSchedule(schedule, { send: body.send, advance: false });

  return json({
    runId: result.runId,
    status: result.status,
    error: result.error,
    sentTo: result.sentTo,
    url: getReportUrl(result.runId),
  });
}
