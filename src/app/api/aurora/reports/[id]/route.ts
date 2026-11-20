import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import type { ReportFrequency } from '@/aurora/lib/constants';
import { getNextRunAt } from '@/aurora/lib/periods';
import { reportScheduleSchema } from '@/aurora/lib/schemas';
import { normalizeEmail } from '@/aurora/lib/tokens';
import prisma from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const { id } = await params;
  const schedule = await prisma.client.auroraReportSchedule.findUnique({ where: { id } });

  return schedule ? json(schedule) : errorJson(404, 'not-found', 'Reporte no encontrado.');
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { body, error } = await auroraRequest(request, reportScheduleSchema, 'editor');

  if (error) {
    return error;
  }

  const { id } = await params;
  const existing = await prisma.client.auroraReportSchedule.findUnique({ where: { id } });

  if (!existing) {
    return errorJson(404, 'not-found', 'Reporte no encontrado.');
  }

  const timezone = body.timezone ?? existing.timezone;
  const reschedule = body.frequency !== existing.frequency || timezone !== existing.timezone;

  return json(
    await prisma.client.auroraReportSchedule.update({
      where: { id },
      data: {
        name: body.name,
        scope: body.scope,
        scopeId: body.scope === 'all' ? null : body.scopeId,
        frequency: body.frequency,
        sections: { ...(existing.sections as object), ...body.sections },
        ...(body.recipients && {
          recipients: Array.from(new Set(body.recipients.map(normalizeEmail))),
        }),
        ...(body.includeClientContacts !== undefined && {
          includeClientContacts: body.includeClientContacts,
        }),
        ...(body.active !== undefined && { active: body.active }),
        timezone,
        ...(reschedule && {
          nextRunAt: getNextRunAt(body.frequency as ReportFrequency, new Date(), timezone),
        }),
      },
    }),
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request, undefined, 'editor');

  if (error) {
    return error;
  }

  const { id } = await params;

  await prisma.client.auroraReportSchedule.deleteMany({ where: { id } });

  return json({ ok: true });
}
