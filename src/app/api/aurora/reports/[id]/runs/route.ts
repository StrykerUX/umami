import { auroraRequest, json } from '@/aurora/lib/api';
import prisma from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const { id } = await params;
  const data = await prisma.client.auroraReportRun.findMany({
    where: { scheduleId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      error: true,
      sentTo: true,
      sentAt: true,
      createdAt: true,
    },
  });

  return json({ data });
}
