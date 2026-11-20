import type { z } from 'zod';
import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { monitorSchema } from '@/aurora/lib/schemas';
import { normalizeEmail } from '@/aurora/lib/tokens';
import prisma from '@/lib/prisma';

async function orgWebsite(orgId: string, websiteId: string) {
  return prisma.client.website.findFirst({
    where: { id: websiteId, teamId: orgId, deletedAt: null },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { ctx, body, error } = await auroraRequest<z.infer<typeof monitorSchema>>(
    request,
    monitorSchema,
    'editor',
  );

  if (error) {
    return error;
  }

  const { websiteId } = await params;

  if (!(await orgWebsite(ctx.orgId, websiteId))) {
    return errorJson(404, 'not-found', 'Sitio no encontrado.');
  }

  const data = {
    url: body.url,
    ...(body.enabled !== undefined && { enabled: body.enabled }),
    ...(body.timeoutMs && { timeoutMs: body.timeoutMs }),
    ...(body.keyword !== undefined && { keyword: body.keyword || null }),
    ...(body.alertEmails && {
      alertEmails: Array.from(new Set(body.alertEmails.map(normalizeEmail))),
    }),
  };

  return json(
    await prisma.client.auroraMonitor.upsert({
      where: { websiteId },
      update: data,
      create: { websiteId, ...data },
    }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { ctx, error } = await auroraRequest(request, undefined, 'editor');

  if (error) {
    return error;
  }

  const { websiteId } = await params;

  if (!(await orgWebsite(ctx.orgId, websiteId))) {
    return errorJson(404, 'not-found', 'Sitio no encontrado.');
  }

  await prisma.client.auroraMonitor.deleteMany({ where: { websiteId } });

  return json({ ok: true });
}
