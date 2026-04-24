import Fastify from 'fastify';
import { config } from './config.js';
import { createServiceLogger } from './logger.js';
import { crawlerRoutes } from './routes/crawler.js';

const logger = createServiceLogger('[server]');

const fastify = Fastify({ logger: false });

fastify.register(crawlerRoutes);

async function start(): Promise<void> {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Listening on port ${config.port}`);
  } catch (error) {
    logger.error('Failed to start', { error });
    process.exit(1);
  }
}

start();
