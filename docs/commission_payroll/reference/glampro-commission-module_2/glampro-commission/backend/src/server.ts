/**
 * Standalone dev server. Without DATABASE_URL it runs on the in-memory repo with demo data.
 *   npm run dev -w backend   ->  http://localhost:4100/api/commission/overview
 * In Glampro: import { createCommissionRouter } from './api/app.js' and mount it on your app instead.
 */
import { createApp } from './api/app.js';
import { MemoryRepo } from './repo/memoryRepo.js';
import type { CommissionRepo } from './repo/types.js';
import { seedDemo } from './seed/demo.js';

async function main() {
  let repo: CommissionRepo;
  if (process.env.DATABASE_URL) {
    const { PrismaClient } = await import('@prisma/client');
    const { PrismaRepo } = await import('./repo/prismaRepo.js');
    repo = new PrismaRepo(new PrismaClient());
    console.log('Using PostgreSQL via Prisma');
  } else {
    repo = new MemoryRepo();
    await seedDemo(repo);
    console.log('Using in-memory demo data (set DATABASE_URL to use PostgreSQL)');
  }
  const port = Number(process.env.PORT ?? 4100);
  createApp(repo).listen(port, () => console.log(`Commission API on http://localhost:${port}/api/commission`));
}
main();
