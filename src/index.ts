import Fastify from 'fastify';
import { config } from './config.js';
import { createServiceLogger } from './logger.js';
import { crawlerRoutes } from './routes/crawler.js';
import { runCrawlerJob } from './services/crawler-job.js';
import {
  connectOrchestrationProducer,
  disconnectOrchestrationKafka,
  startCollectionQueryConsumer,
} from './services/orchestration-kafka.js';

const logger = createServiceLogger('[server]');

const fastify = Fastify({ logger: false });

fastify.register(crawlerRoutes);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Shutting down (${signal})`);
  try {
    await fastify.close();
  } catch (error: unknown) {
    logger.info('Fastify close error', { error });
  }
  await disconnectOrchestrationKafka();
}

async function start(): Promise<void> {
  try {
    await connectOrchestrationProducer();
    startCollectionQueryConsumer(runCrawlerJob);
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Listening on port ${config.port}`);
  } catch (error) {
    logger.error('Failed to start', { error });
    await disconnectOrchestrationKafka();
    process.exit(1);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(0));
});

start();
