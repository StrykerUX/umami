import type { z } from 'zod';
import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { workspaceSchema } from '@/aurora/lib/schemas';
import { slugify } from '@/aurora/lib/slug';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const data = await prisma.client.auroraWorkspace.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { clients: true } } },
  });

  return json({ data });
}

export async function POST(request: Request) {
  const { body, error } = await auroraRequest<z.infer<typeof workspaceSchema>>(
    request,
    workspaceSchema,
    'editor',
  );

  if (error) {
    return error;
  }

  const slug = slugify(body.name);

  if (await prisma.client.auroraWorkspace.findUnique({ where: { slug } })) {
    return errorJson(400, 'duplicate', 'Ya existe un workspace con ese nombre.');
  }

  const workspace = await prisma.client.auroraWorkspace.create({
    data: { id: uuid(), name: body.name, kind: body.kind, color: body.color ?? null, slug },
  });

  return json(workspace);
}
