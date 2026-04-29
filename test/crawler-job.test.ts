import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetNonExistentUids = vi.fn();
const mockSaveVacancy = vi.fn();

vi.mock('../src/services/job-postings-client.js', () => ({
  getNonExistentUids: (...args: unknown[]) => mockGetNonExistentUids(...args),
  saveVacancy: (...args: unknown[]) => mockSaveVacancy(...args),
}));

vi.mock('../src/utils/delay.js', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

const mockCreateBrowser = vi.fn();
const mockCreateContext = vi.fn();

const RUN_ID = '550e8400-e29b-41d4-a716-446655440aaa';

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
    mockSaveVacancy.mockReset();
    mockCreateBrowser.mockClear();
    mockCreateContext.mockClear();
    mockGetNonExistentUids.mockResolvedValue([]);
    mockSaveVacancy.mockResolvedValue(undefined);
    mockCreateBrowser.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('stops when no vacancy cards and sends finish', async () => {
    const $$eval = vi
      .fn()
      .mockResolvedValueOnce([] as string[])
      .mockResolvedValueOnce([] as { uid: string }[]);
    mockCreateContext.mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(makePage({ $$eval })),
    });
    const { runCrawlerJob } = await import('../src/services/crawler-job.js');
    await runCrawlerJob('java', undefined, RUN_ID);
    expect(mockCreateBrowser).toHaveBeenCalledWith(RUN_ID);
    expect($$eval).toHaveBeenCalled();
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
    await expect(runCrawlerJob('q', undefined, RUN_ID)).resolves.toBeUndefined();
    expect(mockGetNonExistentUids).toHaveBeenCalled();
  });

  it('saves new vacancies when pipeline succeeds', async () => {
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
    await runCrawlerJob('keyword', undefined, RUN_ID);
    expect(mockSaveVacancy).toHaveBeenCalledTimes(1);
    expect(mockSaveVacancy.mock.calls[0][0]).toMatchObject({
      uid: 'v1',
      title: 'Title',
    });
  });
});
