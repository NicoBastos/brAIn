import Fastify from 'fastify';
import dotenv from 'dotenv';
import { connectDb, disconnectDb } from '@brain/db';

dotenv.config();

/**
 * Start the Fastify HTTP server for the recommender service.
 *
 * Behavior (scaffolded):
 * - Connects to the DB via @brain/db.connectDb()
 * - Registers a health endpoint GET /healthz → { status: 'ok' }
 * - Attempts to register ./routes/recommend (if present) under prefix /v1
 * - Handles graceful shutdown (SIGINT|SIGTERM) by closing the server and disconnecting DB
 * - On listen error logs and exits with non-zero code
 */
export default async function startRecommender(): Promise<void> {
  const PORT = Number(process.env.PORT || 4004);
  const LOG_LEVEL = (process.env.LOG_LEVEL as any) || 'info';

  const server = Fastify({
    logger: {
      level: LOG_LEVEL,
    },
    // Enable AJV custom options (keeps validator strict and can be tuned later)
    ajv: {
      customOptions: {
        allErrors: true,
        // Additional AJV options can be added here. Fastify manages schema caching itself.
      },
    } as any,
  });

  // Health check
  server.get('/healthz', async () => {
    return { status: 'ok' };
  });

  // Try to register the recommend routes if the module exists.
  // Keep this non-fatal so the server can start for local development even if routes aren't implemented yet.
  try {
    // dynamic import so building the server doesn't require the route at compile time
    // route module should be a Fastify plugin (export default async function (fastify) { ... })
    // and should register POST /recommend (or similar) under its own paths.
    // We'll mount it at /v1.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import('./routes/recommend');
    if (mod && typeof mod.default === 'function') {
      await server.register(mod.default, { prefix: '/v1' });
      server.log.info('Registered recommend routes at /v1');
    } else {
      server.log.debug('recommend module present but does not export a default plugin function');
    }
  } catch (err) {
    // Log at debug level — this is expected in minimal scaffold setups
    server.log.debug({ err }, 'recommend routes not available; skipping registration');
  }

  // Connect DB before listening so route handlers can assume DB is available.
  try {
    await connectDb();
  } catch (err) {
    server.log.error({ err }, 'Failed to connect to database');
    // If DB connection is required for operation, exit non-zero.
    process.exit(1);
  }

  // Start listening
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`@brain/recommender listening on ${PORT}`);
  } catch (err) {
    // Port bind or listen failure — log and exit non-zero after attempting DB disconnect
    server.log.error({ err }, 'Failed to bind port');
    try {
      await disconnectDb();
    } catch (e) {
      server.log.debug({ e }, 'Error while disconnecting DB after listen failure');
    } finally {
      process.exit(1);
    }
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down...`);
    try {
      await server.close();
    } catch (e) {
      server.log.debug({ e }, 'Error closing Fastify server');
    }
    try {
      await disconnectDb();
    } catch (e) {
      server.log.debug({ e }, 'Error disconnecting DB');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}