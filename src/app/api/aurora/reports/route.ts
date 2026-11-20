import { auroraRequest, json } from '@/aurora/lib/api';
import { DEFAULT_REPORT_SECTIONS, DEFAULT_TIMEZONE } from '@/aurora/lib/constants';
import { getNextRunAt } from '@/aurora/lib/periods';
import { reportScheduleSchema } from '@/aurora/lib/schemas';
import { normalizeEmail } from '@/aurora/lib/tokens';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const data = await prisma.client.auroraReportSchedule.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, createdAt: true, sentAt: true },
      },
    },
  });

  return json({ data });
}

export async function POST(request: Request) {
  const { ctx, body, error } = await auroraRequest(request, reportScheduleSchema, 'editor');

  if (error) {
    return error;
  }

  const timezone = body.timezone ?? DEFAULT_TIMEZONE;
  const schedule = await prisma.client.auroraReportSchedule.create({
    data: {
      id: uuid(),
      name: body.name,
      scope: body.scope,
      scopeId: body.scope === 'all' ? null : body.scopeId,
      frequency: body.frequency,
      sections: { ...DEFAULT_REPORT_SECTIONS, ...body.sections },
      recipients: Array.from(new Set((body.recipients ?? []).map(normalizeEmail))),
      includeClientContacts: body.includeClientContacts ?? true,
      timezone,
      active: body.active ?? true,
      nextRunAt: getNextRunAt(body.frequency, new Date(), timezone),
      createdBy: ctx.userId,
    },
  });

  return json(schedule);
}
