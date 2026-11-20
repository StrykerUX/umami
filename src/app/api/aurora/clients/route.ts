import { z } from 'zod';
import { auroraRequest, json } from '@/aurora/lib/api';
import { cleanClientInput, clientSchema } from '@/aurora/lib/schemas';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { query, error } = await auroraRequest(
    request,
    z.object({ workspaceId: z.uuid().optional(), clientTypeId: z.uuid().optional() }),
  );

  if (error) {
    return error;
  }

  const clients = await prisma.client.auroraClient.findMany({
    where: {
      ...(query.workspaceId && { workspaceId: query.workspaceId }),
      ...(query.clientTypeId && { clientTypeId: query.clientTypeId }),
    },
    include: { workspace: true, clientType: true },
    orderBy: { name: 'asc' },
  });
  const metas = await prisma.client.auroraWebsiteMeta.findMany({
    where: { clientId: { in: clients.map(c => c.id) } },
    select: { clientId: true },
  });
  const countMap = new Map<string, number>();
  for (const m of metas) {
    if (m.clientId) countMap.set(m.clientId, (countMap.get(m.clientId) ?? 0) + 1);
  }

  return json({ data: clients.map(c => ({ ...c, websiteCount: countMap.get(c.id) ?? 0 })) });
}

export async function POST(request: Request) {
  const { body, error } = await auroraRequest<z.infer<typeof clientSchema>>(
    request,
    clientSchema,
    'editor',
  );

  if (error) {
    return error;
  }

  const client = await prisma.client.auroraClient.create({
    data: { id: uuid(), ...cleanClientInput(body), name: body.name },
    include: { workspace: true, clientType: true },
  });

  return json(client);
}
