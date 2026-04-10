import type { FastifyInstance } from 'fastify';
import { runCrawlerJob } from '../services/crawler-job.js';

let isRunning = false;

const bodySchema = {
  type: 'object',
  required: ['list'],
  properties: {
    list: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
  },
  additionalProperties: false,
} as const;

interface StartBody {
  list: string[];
}

export async function crawlerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: StartBody }>(
    '/crawler/start',
    { schema: { body: bodySchema } },
    async (request, reply) => {
      if (isRunning) {
        console.log('[route] Crawler already running, ignoring duplicate request');
        return reply.code(200).send();
      }

      isRunning = true;
      console.log('[route] Starting crawler job in background');

      runCrawlerJob(request.body.list)
        .catch((error: unknown) => {
          console.log('[route] Crawler job error:', error);
        })
        .finally(() => {
          isRunning = false;
          console.log('[route] Crawler job finished, ready for next request');
        });

      return reply.code(200).send();
    },
  );
}
