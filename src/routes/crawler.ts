import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { createServiceLogger } from '../logger.js';
import { runCrawlerJob } from '../services/crawler-job.js';

const logger = createServiceLogger('[route]');

const bodySchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
    },
    lazy: {
      type: 'boolean',
      default: false,
    },
  },
  additionalProperties: false,
} as const;

interface StartBody {
  query: string;
  lazy?: boolean;
}

export async function crawlerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: StartBody }>(
    '/crawler/start',
    { schema: { body: bodySchema } },
    async (request, reply) => {
      if (!request.body.query.trim()) {
        return reply.code(400).send();
      }

      const runId = uuidv4();
      logger.info('Starting crawler job in background', { runId });

      const rawCorrelation = request.headers['x-joposcragent-correlationid'];
      const correlationId =
        typeof rawCorrelation === 'string'
          ? rawCorrelation
          : Array.isArray(rawCorrelation)
            ? rawCorrelation[0]
            : undefined;

      runCrawlerJob(
        request.body.query.trim(),
        correlationId,
        runId,
        request.body.lazy === true,
      )
        .catch((error: unknown) => {
          logger.error('Crawler job error', { error, runId });
        })
        .finally(() => {
          logger.info('Crawler job finished', { runId });
        });

      return reply.code(200).send();
    },
  );
}
