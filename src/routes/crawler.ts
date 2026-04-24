import type { FastifyInstance } from 'fastify';
import { createServiceLogger } from '../logger.js';
import { runCrawlerJob } from '../services/crawler-job.js';

const logger = createServiceLogger('[route]');

let isRunning = false;

const bodySchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
    },
  },
  additionalProperties: false,
} as const;

interface StartBody {
  query: string;
}

export async function crawlerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: StartBody }>(
    '/crawler/start',
    { schema: { body: bodySchema } },
    async (request, reply) => {
      if (!request.body.query.trim()) {
        return reply.code(400).send();
      }
      if (isRunning) {
        logger.info('Crawler already running, ignoring duplicate request');
        return reply.code(200).send();
      }

      isRunning = true;
      logger.info('Starting crawler job in background');

      runCrawlerJob(request.body.query.trim())
        .catch((error: unknown) => {
          logger.error('Crawler job error', { error });
        })
        .finally(() => {
          isRunning = false;
          logger.info('Crawler job finished, ready for next request');
        });

      return reply.code(200).send();
    },
  );
}
