import { prisma } from '../src/lib/db.js';

async function show() {
  const m = await prisma.message.findFirst({
    where: { sender: 'assistant' },
    orderBy: { createdAt: 'desc' }
  });
  const l = await prisma.aIInteractionLog.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  console.log(JSON.stringify({ message: m, log: l }, null, 2));
}

show().finally(() => prisma.$disconnect());
