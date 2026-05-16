import { randomUUID } from 'node:crypto';
import { Kafka, logLevel, type Consumer, type IHeaders, type Producer } from 'kafkajs';
import { config } from '../config.js';
import { createServiceLogger } from '../logger.js';

const logger = createServiceLogger('[orchestration-kafka]');

export const TOPIC_COLLECTION_QUERY = 'async-job.collection-query';
export const TOPIC_JOB_POSTING_CREATE = 'async-job.job-posting-create';

export const TYPE_COLLECTION_QUERY_BEGIN = 'async-job.collection-query-begin';
export const TYPE_COLLECTION_QUERY_RESULT = 'async-job.collection-query-result';
export const TYPE_JOB_POSTING_CREATE_BEGIN = 'async-job.job-posting-create-begin';

const SCHEMA_VERSION = '1.0';

/** 8-4-4-4-12 hex; без проверки version/variant RFC 4122 (GUID из БД и т.п. могут иметь любые hex-нибблы). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

function kafkaBrokers(): string[] {
  return config.kafkaBootstrapServers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

let kafkaSingleton: Kafka | null = null;
let producerSingleton: Producer | null = null;
let consumerSingleton: Consumer | null = null;

function getKafka(): Kafka {
  if (!kafkaSingleton) {
    kafkaSingleton = new Kafka({
      clientId: config.kafkaClientId,
      brokers: kafkaBrokers(),
      logLevel: logLevel.NOTHING,
    });
  }
  return kafkaSingleton;
}

function headerStrings(headers: IHeaders | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  const raw = headers[name];
  if (raw === undefined) {
    return undefined;
  }
  const buf = Array.isArray(raw) ? raw[0] : raw;
  if (buf === undefined) {
    return undefined;
  }
  return Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
}

function messageKeyString(key: Buffer | null): string {
  if (!key) {
    return '';
  }
  return key.toString('utf8');
}

function formatErrorBrief(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildPayloadJson(payload: Record<string, unknown>): { json: string; createdAt: string } {
  const createdAt = new Date().toISOString();
  return { json: JSON.stringify(payload), createdAt };
}

function recordHeaders(
  createdAt: string,
  messageKey: string,
  messageType: string,
): Record<string, Buffer> {
  return {
    key: Buffer.from(messageKey, 'utf8'),
    type: Buffer.from(messageType, 'utf8'),
    createdAt: Buffer.from(createdAt, 'utf8'),
    schemaVersion: Buffer.from(SCHEMA_VERSION, 'utf8'),
  };
}

async function sendEnvelope(
  topic: string,
  messageKey: string,
  messageType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const p = producerSingleton;
  if (!p) {
    throw new Error('Kafka producer is not connected');
  }
  const { json, createdAt } = buildPayloadJson(payload);
  await p.send({
    topic,
    messages: [
      {
        key: messageKey,
        value: json,
        headers: recordHeaders(createdAt, messageKey, messageType),
      },
    ],
  });
}

export async function connectOrchestrationProducer(): Promise<void> {
  if (producerSingleton) {
    return;
  }
  const producer = getKafka().producer();
  await producer.connect();
  producerSingleton = producer;
  logger.info('Kafka producer connected');
}

export async function disconnectOrchestrationKafka(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (consumerSingleton) {
    tasks.push(consumerSingleton.disconnect().catch((e) => logger.info('consumer disconnect', { e })));
    consumerSingleton = null;
  }
  if (producerSingleton) {
    tasks.push(
      producerSingleton.disconnect().catch((e) => logger.info('producer disconnect', { e })),
    );
    producerSingleton = null;
  }
  await Promise.all(tasks);
}

export type JobPostingCreateBeginParams = {
  currentJobUuid: string;
  jobPostingUuid: string;
  parentJobUuid: string | undefined;
  searchQueryUuid: string;
  uid: string;
  title: string;
  url: string;
  company: string;
  content: string;
  publicationDate: string;
};

export async function publishJobPostingCreateBegin(
  params: JobPostingCreateBeginParams,
): Promise<void> {
  const messageKey = params.currentJobUuid;
  const payload: Record<string, unknown> = {
    jobUuid: params.currentJobUuid,
    entityUuid: params.jobPostingUuid,
    jobPostingUuid: params.jobPostingUuid,
    searchQueryUuid: params.searchQueryUuid,
    uid: params.uid,
    title: params.title,
    url: params.url,
    company: params.company,
    content: params.content,
    publicationDate: params.publicationDate,
  };
  if (params.parentJobUuid !== undefined && params.parentJobUuid.length > 0) {
    payload.parentJobUuid = params.parentJobUuid;
  }
  await sendEnvelope(
    TOPIC_JOB_POSTING_CREATE,
    messageKey,
    TYPE_JOB_POSTING_CREATE_BEGIN,
    payload,
  );
}

export async function publishCollectionQuerySucceeded(options: {
  collectionJobUuid: string;
  pagesProcessed: number;
  newVacanciesSaved: number;
}): Promise<void> {
  const key = options.collectionJobUuid;
  const result = `Обработано страниц ${options.pagesProcessed}, загружено ${options.newVacanciesSaved} новых вакансий`;
  await sendEnvelope(TOPIC_COLLECTION_QUERY, key, TYPE_COLLECTION_QUERY_RESULT, {
    jobUuid: options.collectionJobUuid,
    pagesProcessed: options.pagesProcessed,
    newVacanciesSaved: options.newVacanciesSaved,
    status: 'SUCCEEDED',
    result,
  });
}

export async function publishCollectionQueryCanceled(options: {
  collectionJobUuid: string;
  pagesProcessed: number;
  newVacanciesSaved: number;
  result: string;
}): Promise<void> {
  const key = options.collectionJobUuid;
  await sendEnvelope(TOPIC_COLLECTION_QUERY, key, TYPE_COLLECTION_QUERY_RESULT, {
    jobUuid: options.collectionJobUuid,
    pagesProcessed: options.pagesProcessed,
    newVacanciesSaved: options.newVacanciesSaved,
    status: 'CANCELED',
    result: options.result,
  });
}

export async function publishCollectionQueryFailed(options: {
  messageKey: string;
  errorMessage: string;
  pagesProcessed?: number;
  newVacanciesSaved?: number;
}): Promise<void> {
  const key = options.messageKey;
  await sendEnvelope(TOPIC_COLLECTION_QUERY, key, TYPE_COLLECTION_QUERY_RESULT, {
    jobUuid: key,
    pagesProcessed: options.pagesProcessed ?? 0,
    newVacanciesSaved: options.newVacanciesSaved ?? 0,
    status: 'FAILED',
    result: options.errorMessage,
  });
}

type CollectionQueryBeginPayload = {
  query: string;
  searchQueryUuid: string;
  lazy: boolean;
};

function parseCollectionQueryBeginPayload(
  raw: unknown,
): { ok: true; value: CollectionQueryBeginPayload } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'payload is not an object' };
  }
  const o = raw as Record<string, unknown>;
  const query = typeof o.query === 'string' ? o.query.trim() : '';
  const searchQueryUuid =
    typeof o.searchQueryUuid === 'string' && isUuid(o.searchQueryUuid)
      ? o.searchQueryUuid.trim()
      : '';
  const lazy = o.lazy === true;
  if (!query) {
    return { ok: false, error: 'missing or empty query' };
  }
  if (!searchQueryUuid) {
    return { ok: false, error: 'missing or invalid searchQueryUuid' };
  }
  return { ok: true, value: { query, searchQueryUuid, lazy } };
}

function unwrapPayload(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const o = raw as Record<string, unknown>;
  const h = o.headers;
  const p = o.payload;
  if (
    h !== null &&
    typeof h === 'object' &&
    !Array.isArray(h) &&
    p !== null &&
    typeof p === 'object' &&
    !Array.isArray(p)
  ) {
    return p;
  }
  return raw;
}

export type CrawlerRunFn = (
  searchQuery: string,
  searchQueryUuid: string,
  correlationId: string | undefined,
  runId: string,
  lazy?: boolean,
) => Promise<void>;

const CONSUMER_HEARTBEAT_TICK_MS = 5000;

async function handleCollectionQueryMessage(
  runJob: CrawlerRunFn,
  message: { headers?: IHeaders; key: Buffer | null; value: Buffer | null },
): Promise<void> {
  const type = headerStrings(message.headers, 'type');
  if (type !== TYPE_COLLECTION_QUERY_BEGIN) {
    return;
  }
  const keyHeader = headerStrings(message.headers, 'key');
  const keyFromRecord = messageKeyString(message.key);
  const jobUuid = (keyHeader?.trim() || keyFromRecord.trim()) || '';
  let json: unknown;
  try {
    json = JSON.parse(message.value?.toString('utf8') ?? 'null');
  } catch {
    logger.error('collection-query-begin: invalid json');
    const failKey = isUuid(jobUuid) ? jobUuid : randomUUID();
    await publishCollectionQueryFailed({
      messageKey: failKey,
      errorMessage: 'invalid message json',
    }).catch((e) => logger.info('failed to publish FAILED result', { e }));
    return;
  }
  const root = unwrapPayload(json);
  const parsed = parseCollectionQueryBeginPayload(root);
  const keyOk = jobUuid.length > 0 && isUuid(jobUuid);
  if (!parsed.ok || !keyOk) {
    const errParts = [
      !keyOk ? 'missing or invalid message key (header key / record key)' : '',
      !parsed.ok ? parsed.error : '',
    ].filter(Boolean);
    logger.error('collection-query-begin: invalid message', {
      error: errParts.join('; '),
    });
    const failKey = keyOk ? jobUuid : randomUUID();
    await publishCollectionQueryFailed({
      messageKey: failKey,
      errorMessage: errParts.join('; ') || 'invalid message',
    }).catch((e) => logger.info('failed to publish FAILED result', { e }));
    return;
  }
  const { query, searchQueryUuid, lazy } = parsed.value;
  const runId = `kafka-${jobUuid}`;
  try {
    await runJob(query, searchQueryUuid, jobUuid, runId, lazy);
  } catch (error: unknown) {
    logger.error('collection-query-begin: job failed', { error });
    await publishCollectionQueryFailed({
      messageKey: jobUuid,
      errorMessage: formatErrorBrief(error),
    }).catch((e) => logger.info('failed to publish FAILED result', { e }));
  }
}

export function startCollectionQueryConsumer(runJob: CrawlerRunFn): void {
  void (async () => {
    try {
      const consumer = getKafka().consumer({
        groupId: config.kafkaConsumerGroupId,
      });
      consumerSingleton = consumer;
      await consumer.connect();
      await consumer.subscribe({
        topic: TOPIC_COLLECTION_QUERY,
        fromBeginning: false,
      });
      logger.info('Kafka consumer subscribed', {
        topic: TOPIC_COLLECTION_QUERY,
        groupId: config.kafkaConsumerGroupId,
      });
      await consumer.run({
        eachBatchAutoResolve: false,
        eachBatch: async ({
          batch,
          heartbeat,
          resolveOffset,
          commitOffsetsIfNecessary,
          isRunning,
          isStale,
        }) => {
          for (const message of batch.messages) {
            if (!isRunning() || isStale()) {
              break;
            }
            const heartbeatTimer = setInterval(() => {
              void heartbeat().catch((error: unknown) => {
                logger.info('Kafka consumer heartbeat failed during message processing', {
                  error,
                });
              });
            }, CONSUMER_HEARTBEAT_TICK_MS);
            try {
              await handleCollectionQueryMessage(runJob, message);
            } finally {
              clearInterval(heartbeatTimer);
            }
            resolveOffset(message.offset);
            await commitOffsetsIfNecessary();
            await heartbeat();
          }
        },
      });
    } catch (error: unknown) {
      logger.error('Kafka consumer failed to start', { error });
      process.exit(1);
    }
  })();
}
