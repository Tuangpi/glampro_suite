/** `npm run seed -w backend` – loads demo data into the configured database (Prisma). */
import { PrismaClient } from '@prisma/client';
import { PrismaRepo } from '../repo/prismaRepo.js';
import { seedDemo } from './demo.js';

const prisma = new PrismaClient();
seedDemo(new PrismaRepo(prisma))
  .then(() => console.log('Demo data loaded'))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
