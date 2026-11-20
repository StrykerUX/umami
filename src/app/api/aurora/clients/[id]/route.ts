import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { cleanClientInput, clientSchema } from '@/aurora/lib/schemas';
import prisma from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const { id } = await params;
  const client = await prisma.client.auroraClient.findUnique({
    where: { id },
    include: { workspace: true, clientType: true },
  });

  if (!client) {
    return errorJson(404, 'not-found', 'Cliente no encontrado.');
  }

  const metas = await prisma.client.auroraWebsiteMeta.findMany({ where: { clientId: id } });

  return json({ ...client, websiteIds: metas.map(m => m.websiteId) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { body, error } = await auroraRequest(request, clientSchema.partial(), 'editor');

  if (error) {
    return error;
  }

  const { id } = await params;

  if (!(await prisma.client.auroraClient.findUnique({ where: { id } }))) {
    return errorJson(404, 'not-found', 'Cliente no encontrado.');
  }

  return json(
    await prisma.client.auroraClient.update({
      where: { id },
      data: cleanClientInput(body),
      include: { workspace: true, clientType: true },
    }),
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const { id } = await params;

  await prisma.client.$transaction([
    prisma.client.auroraWebsiteMeta.updateMany({
      where: { clientId: id },
      data: { clientId: null },
    }),
    prisma.client.auroraClient.deleteMany({ where: { id } }),
  ]);

  return json({ ok: true });
}
