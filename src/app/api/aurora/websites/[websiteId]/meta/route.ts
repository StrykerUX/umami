import type { z } from 'zod';
import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { websiteMetaSchema } from '@/aurora/lib/schemas';
import prisma from '@/lib/prisma';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { ctx, body, error } = await auroraRequest<z.infer<typeof websiteMetaSchema>>(
    request,
    websiteMetaSchema,
    'editor',
  );

  if (error) {
    return error;
  }

  const { websiteId } = await params;
  const website = await prisma.client.website.findFirst({
    where: { id: websiteId, teamId: ctx.orgId, deletedAt: null },
  });

  if (!website) {
    return errorJson(404, 'not-found', 'Sitio no encontrado.');
  }

  if (
    body.clientId &&
    !(await prisma.client.auroraClient.findUnique({ where: { id: body.clientId } }))
  ) {
    return errorJson(400, 'bad-client', 'Cliente inválido.');
  }

  if (
    body.workspaceId &&
    !(await prisma.client.auroraWorkspace.findUnique({ where: { id: body.workspaceId } }))
  ) {
    return errorJson(400, 'bad-workspace', 'Workspace inválido.');
  }

  // A client implies its workspace when none is given.
  let workspaceId = body.workspaceId;
  if (workspaceId === undefined && body.clientId) {
    workspaceId = (await prisma.client.auroraClient.findUnique({ where: { id: body.clientId } }))
      ?.workspaceId;
  }

  const data = {
    ...(workspaceId !== undefined && { workspaceId }),
    ...(body.clientId !== undefined && { clientId: body.clientId }),
    ...(body.tags && { tags: Array.from(new Set(body.tags)) }),
  };

  const meta = await prisma.client.auroraWebsiteMeta.upsert({
    where: { websiteId },
    update: data,
    create: { websiteId, ...data },
  });

  return json(meta);
}
