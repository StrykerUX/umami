import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { getReportUrl } from '@/aurora/lib/report';
import prisma from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const { runId } = await params;
  const run = await prisma.client.auroraReportRun.findUnique({ where: { id: runId } });

  if (!run) {
    return errorJson(404, 'not-found', 'Ejecución no encontrada.');
  }

  return json({ ...run, shareUrl: getReportUrl(run.id) });
}
