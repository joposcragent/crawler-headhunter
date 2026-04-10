import Fastify from 'fastify';
import { config } from './config.js';
import { crawlerRoutes } from './routes/crawler.js';

const fastify = Fastify({ logger: false });

fastify.register(crawlerRoutes);

async function start(): Promise<void> {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[server] Listening on port ${config.port}`);
  } catch (error) {
    console.error('[server] Failed to start:', error);
    process.exit(1);
  }
}

start();
