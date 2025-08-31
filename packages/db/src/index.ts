import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Initialize DB connection (call at service startup)
 */
export async function connectDb() {
  try {
    await prisma.$connect();
    // optional: run simple query to verify
    await prisma.$queryRaw`SELECT 1`;
    console.info('Prisma: connected');
  } catch (err) {
    console.error('Prisma connect error', err);
    throw err;
  }
}

/**
 * Disconnect DB client (call on shutdown)
 */
export async function disconnectDb() {
  try {
    await prisma.$disconnect();
    console.info('Prisma: disconnected');
  } catch (err) {
    console.error('Prisma disconnect error', err);
  }
}

export default prisma;