import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { workspaceSchema } from '@/aurora/lib/schemas';
import { slugify } from '@/aurora/lib/slug';
import prisma from '@/lib/prisma';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const schema = workspaceSchema.partial();
  const { body, error } = await auroraRequest(request, schema, 'editor');

  if (error) {
    return error;
  }

  const { id } = await params;
  const existing = await prisma.client.auroraWorkspace.findUnique({ where: { id } });

  if (!existing) {
    return errorJson(404, 'not-found', 'Workspace no encontrado.');
  }

  const data: any = { ...body };

  if (body.name) {
    data.slug = slugify(body.name);
    const clash = await prisma.client.auroraWorkspace.findUnique({ where: { slug: data.slug } });
    if (clash && clash.id !== id) {
      return errorJson(400, 'duplicate', 'Ya existe un workspace con ese nombre.');
    }
  }

  return json(await prisma.client.auroraWorkspace.update({ where: { id }, data }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const { id } = await params;

  await prisma.client.$transaction([
    prisma.client.auroraWebsiteMeta.updateMany({
      where: { workspaceId: id },
      data: { workspaceId: null },
    }),
    prisma.client.auroraWorkspace.deleteMany({ where: { id } }),
  ]);

  return json({ ok: true });
}
