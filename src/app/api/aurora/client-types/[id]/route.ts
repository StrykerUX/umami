import { auroraRequest, json } from '@/aurora/lib/api';
import prisma from '@/lib/prisma';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const { id } = await params;

  await prisma.client.auroraClientType.deleteMany({ where: { id } });

  return json({ ok: true });
}
