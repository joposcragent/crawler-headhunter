import axios, { type AxiosInstance } from 'axios';
import { config } from '../config.js';
import { createServiceLogger } from '../logger.js';

let defaultClient: AxiosInstance | null = null;

function orchestratorClient(): AxiosInstance {
  if (!defaultClient) {
    defaultClient = axios.create({ baseURL: config.celeryOrchestratorUrl });
  }
  return defaultClient;
}

function formatErrorBrief(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatErrorFull(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

export type VacancyProgressStatus = 'SUCCEEDED' | 'FAILED';

export type FinishParams = {
  jobError: unknown | null;
  pagesProcessed: number;
  newVacanciesSaved: number;
};

export type EventsProducerDeps = {
  client?: AxiosInstance;
  /** Identifies the crawl run in logs (orchestrator payloads unchanged). */
  runId?: string;
};

export type EventsProducer = {
  sendVacancyProgress: (params: {
    createdAt: string;
    executionLog: string;
    jobPostingUuid: string;
    status: VacancyProgressStatus;
  }) => Promise<void>;
  sendPageProcessedProgress: (params: {
    currentPage: number;
    totalPages: number;
  }) => Promise<void>;
  sendFinish: (params: FinishParams) => Promise<void>;
};

export function createEventsProducer(
  correlationId: string | undefined,
  deps?: EventsProducerDeps,
): EventsProducer {
  const runId = deps?.runId ?? 'na';
  const logger = createServiceLogger(`[events-producer][${runId}]`);
  const id = correlationId?.trim() ?? '';
  const enabled = id.length > 0;
  const client = deps?.client ?? orchestratorClient();

  async function postJson(
    path: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    try {
      const response = await client.post(path, body, {
        validateStatus: () => true,
      });
      if (response.status !== 204) {
        logger.info('Orchestrator returned non-204', {
          path,
          status: response.status,
          data: response.data,
        });
      }
    } catch (error: unknown) {
      logger.info('Orchestrator request failed', { path, error });
    }
  }

  return {
    async sendVacancyProgress(params): Promise<void> {
      if (!enabled) {
        return;
      }
      await postJson('/events-queue/progress', {
        correlationId: id,
        createdAt: params.createdAt,
        executionLog: params.executionLog,
        jobPostingUuid: params.jobPostingUuid,
        status: params.status,
      });
    },

    async sendPageProcessedProgress(params): Promise<void> {
      if (!enabled || params.totalPages <= 1) {
        return;
      }
      const createdAt = new Date().toISOString();
      await postJson('/events-queue/progress', {
        correlationId: id,
        createdAt,
        executionLog: `Обработана страница ${params.currentPage} из ${params.totalPages}`,
      });
    },

    async sendFinish(params): Promise<void> {
      if (!enabled) {
        return;
      }
      const createdAt = new Date().toISOString();
      if (params.jobError != null) {
        await postJson('/events-queue/finish', {
          correlationId: id,
          createdAt,
          status: 'FAILED',
          result: formatErrorBrief(params.jobError),
          executionLog: formatErrorFull(params.jobError),
        });
        return;
      }
      const result = `Обработано страниц ${params.pagesProcessed}, загружено ${params.newVacanciesSaved} новых вакансий`;
      await postJson('/events-queue/finish', {
        correlationId: id,
        createdAt,
        status: 'SUCCEEDED',
        result,
      });
    },
  };
}
