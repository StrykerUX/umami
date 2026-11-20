import { z } from 'zod';
import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const data = await prisma.client.auroraClientType.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { clients: true } } },
  });

  return json({ data });
}

export async function POST(request: Request) {
  const schema = z.object({ name: z.string().trim().min(1).max(100) });
  const { body, error } = await auroraRequest<z.infer<typeof schema>>(request, schema, 'editor');

  if (error) {
    return error;
  }

  if (await prisma.client.auroraClientType.findUnique({ where: { name: body.name } })) {
    return errorJson(400, 'duplicate', 'Ese tipo de cliente ya existe.');
  }

  return json(
    await prisma.client.auroraClientType.create({ data: { id: uuid(), name: body.name } }),
  );
}
