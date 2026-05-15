import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetNonExistentUids = vi.fn();
const mockPublishBegin = vi.fn();
const mockPublishSucceeded = vi.fn();
const mockPublishCanceled = vi.fn();
const mockPublishFailed = vi.fn();

vi.mock('../src/services/job-postings-client.js', () => ({
  getNonExistentUids: (...args: unknown[]) => mockGetNonExistentUids(...args),
}));

vi.mock('../src/services/orchestration-kafka.js', () => ({
  publishJobPostingCreateBegin: (...args: unknown[]) => mockPublishBegin(...args),
  publishCollectionQuerySucceeded: (...args: unknown[]) => mockPublishSucceeded(...args),
  publishCollectionQueryCanceled: (...args: unknown[]) => mockPublishCanceled(...args),
  publishCollectionQueryFailed: (...args: unknown[]) => mockPublishFailed(...args),
}));

vi.mock('../src/utils/delay.js', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

const mockCreateBrowser = vi.fn();
const mockCreateContext = vi.fn();

const RUN_ID = '550e8400-e29b-41d4-a716-446655440aaa';
const SEARCH_QUERY_UUID = '550e8400-e29b-41d4-a716-4466554400b1';
const CORRELATION_ID = '550e8400-e29b-41d4-a716-4466554400c2';

vi.mock('../src/utils/browser.js', () => ({
  createBrowser: mockCreateBrowser,
  createContext: mockCreateContext,
}));

function makePage(mocks: {
  $$eval: ReturnType<typeof vi.fn>;
  goto?: ReturnType<typeof vi.fn>;
  $eval?: ReturnType<typeof vi.fn>;
  evaluate?: ReturnType<typeof vi.fn>;
}) {
  return {
    goto: mocks.goto ?? vi.fn().mockResolvedValue(undefined),
    $$eval: mocks.$$eval,
    $eval: mocks.$eval ?? vi.fn(),
    evaluate: mocks.evaluate ?? vi.fn(),
  };
}

describe('runCrawlerJob', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockGetNonExistentUids.mockReset();
    mockPublishBegin.mockReset();
    mockPublishSucceeded.mockReset();
    mockPublishCanceled.mockReset();
    mockPublishFailed.mockReset();
    mockCreateBrowser.mockClear();
    mockCreateContext.mockClear();
    mockGetNonExistentUids.mockResolvedValue([]);
    mockPublishBegin.mockResolvedValue(undefined);
    mockPublishSucceeded.mockResolvedValue(undefined);
    mockPublishCanceled.mockResolvedValue(undefined);
    mockPublishFailed.mockResolvedValue(undefined);
    mockCreateBrowser.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('stops when no vacancy cards', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([] as { uid: string }[]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('java', SEARCH_QUERY_UUID, undefined, RUN_ID);
    expect(mockCreateBrowser).toHaveBeenCalledWith(RUN_ID);
    expect($$eval).toHaveBeenCalled();
    expect(mockPublishSucceeded).not.toHaveBeenCalled();
    expect(mockPublishFailed).not.toHaveBeenCalled();
  });

  it('records job error when getNonExistentUids throws', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([{ uid: '1', title: 't', company: 'c', url: 'u' }]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    mockGetNonExistentUids.mockRejectedValue(new Error('crud down'));
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await expect(runCrawlerJob('q', SEARCH_QUERY_UUID, undefined, RUN_ID)).resolves.toBeUndefined();
    expect(mockGetNonExistentUids).toHaveBeenCalled();
  });

  it('publishes job-posting-create-begin when pipeline succeeds', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([
        { uid: 'v1', title: 'Title', company: 'Co', url: 'https://hh.ru/vacancy/v1' },
      ]);
    const $eval = vi.fn().mockResolvedValue('<p>x</p>');
    const evaluate = vi
      .fn()
      .mockResolvedValue('Вакансия опубликована 1 января 2025');
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(
        makePage({ $$eval, $eval, evaluate }),
      ),
    });
    mockGetNonExistentUids.mockResolvedValue(['v1']);
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('keyword', SEARCH_QUERY_UUID, undefined, RUN_ID);
    expect(mockPublishBegin).toHaveBeenCalledTimes(1);
    expect(mockPublishBegin.mock.calls[0][0]).toMatchObject({
      uid: 'v1',
      title: 'Title',
      searchQueryUuid: SEARCH_QUERY_UUID,
    });
    expect(mockPublishBegin.mock.calls[0][0].publicationDate).toMatch(
      /^2025-01-01T12:00:00\.000Z$/,
    );
  });

  it('with correlationId sends collection-query-result CANCELED when no vacancies', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([] as { uid: string }[]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('java', SEARCH_QUERY_UUID, CORRELATION_ID, RUN_ID);
    expect(mockPublishCanceled).toHaveBeenCalledWith({
      collectionJobUuid: CORRELATION_ID,
      pagesProcessed: 1,
      newVacanciesSaved: 0,
      result: 'По запросу не найдено ни одной вакансии.',
    });
    expect(mockPublishSucceeded).not.toHaveBeenCalled();
  });

  it('with correlationId sends CANCELED when vacancies exist but none are new', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([
        { uid: 'old', title: 't', company: 'c', url: 'http://hh.ru/vacancy/old' },
      ]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    mockGetNonExistentUids.mockResolvedValue([]);
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('keyword', SEARCH_QUERY_UUID, CORRELATION_ID, RUN_ID, true);
    expect(mockPublishCanceled).toHaveBeenCalledWith({
      collectionJobUuid: CORRELATION_ID,
      pagesProcessed: 1,
      newVacanciesSaved: 0,
      result: 'Вакансии по запросу есть, но новых для сохранения нет.',
    });
    expect(mockPublishSucceeded).not.toHaveBeenCalled();
  });

  it('with correlationId sends SUCCEEDED when at least one new vacancy is saved', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([
        { uid: 'v1', title: 'Title', company: 'Co', url: 'https://hh.ru/vacancy/v1' },
      ]);
    const $eval = vi.fn().mockResolvedValue('<p>x</p>');
    const evaluate = vi
      .fn()
      .mockResolvedValue('Вакансия опубликована 1 января 2025');
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(
        makePage({ $$eval, $eval, evaluate }),
      ),
    });
    mockGetNonExistentUids.mockResolvedValue(['v1']);
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('keyword', SEARCH_QUERY_UUID, CORRELATION_ID, RUN_ID);
    expect(mockPublishSucceeded).toHaveBeenCalledWith({
      collectionJobUuid: CORRELATION_ID,
      pagesProcessed: 1,
      newVacanciesSaved: 1,
    });
    expect(mockPublishCanceled).not.toHaveBeenCalled();
  });

  it('with correlationId sends FAILED when getNonExistentUids throws', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([{ uid: '1', title: 't', company: 'c', url: 'u' }]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    mockGetNonExistentUids.mockRejectedValue(new Error('crud down'));
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('q', SEARCH_QUERY_UUID, CORRELATION_ID, RUN_ID);
    expect(mockPublishFailed).toHaveBeenCalledWith({
      messageKey: CORRELATION_ID,
      errorMessage: 'crud down',
      pagesProcessed: 1,
      newVacanciesSaved: 0,
    });
  });

  it('with lazy=true stops page loop when all uids on page already exist', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce(['/p2', '/p3'])
      .mockResolvedValueOnce([
        { uid: 'old', title: 't', company: 'c', url: 'http://hh.ru/vacancy/old' },
      ]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    mockGetNonExistentUids.mockResolvedValue([]);
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('keyword', SEARCH_QUERY_UUID, undefined, RUN_ID, true);
    expect($$eval).toHaveBeenCalledTimes(2);
    expect(mockPublishBegin).not.toHaveBeenCalled();
  });

  it('with lazy=false continues when first page has no new uids', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce(['/p2', '/p3'])
      .mockResolvedValueOnce([
        { uid: 'old', title: 't', company: 'c', url: 'http://hh.ru/vacancy/old' },
      ])
      .mockResolvedValueOnce([
        {
          uid: 'new',
          title: 'T2',
          company: 'C2',
          url: 'http://hh.ru/vacancy/new',
        },
      ]);
    const $eval = vi.fn().mockResolvedValue('<p>x</p>');
    const evaluate = vi
      .fn()
      .mockResolvedValue('Вакансия опубликована 1 января 2025');
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(
        makePage({ $$eval, $eval, evaluate }),
      ),
    });
    mockGetNonExistentUids
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['new']);
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('keyword', SEARCH_QUERY_UUID, undefined, RUN_ID, false);
    expect($$eval).toHaveBeenCalledTimes(3);
    expect(mockPublishBegin).toHaveBeenCalledTimes(1);
    expect(mockPublishBegin.mock.calls[0][0]).toMatchObject({
      uid: 'new',
      searchQueryUuid: SEARCH_QUERY_UUID,
    });
  });
});
