import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const { runCrawlerJobMock } = vi.hoisted(() => ({
  runCrawlerJobMock: vi
    .fn()
    .mockImplementation(() => new Promise<void>((resolve) => setImmediate(resolve))),
}));

vi.mock('../src/services/crawler-job.js', () => ({
  runCrawlerJob: runCrawlerJobMock,
}));

describe('crawlerRoutes', () => {
  it('returns 400 for empty query', async () => {
    const { crawlerRoutes } = await import('../src/routes/crawler.js');
    const app = Fastify({ logger: false });
    await app.register(crawlerRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/crawler/start',
      payload: { query: '   ' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('passes correlation header to runCrawlerJob', async () => {
    runCrawlerJobMock.mockClear();
    const { crawlerRoutes } = await import('../src/routes/crawler.js');
    const app = Fastify({ logger: false });
    await app.register(crawlerRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/crawler/start',
      headers: {
        'x-joposcragent-correlationid': 'corr-uuid-1',
      },
      payload: { query: 'python' },
    });
    expect(res.statusCode).toBe(200);
    expect(runCrawlerJobMock).toHaveBeenCalledWith('python', 'corr-uuid-1');
    await app.close();
  });

  it('ignores duplicate start while job running', async () => {
    runCrawlerJobMock.mockClear();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runCrawlerJobMock.mockImplementationOnce(() => gate);

    const { crawlerRoutes } = await import('../src/routes/crawler.js');
    const app = Fastify({ logger: false });
    await app.register(crawlerRoutes);

    const firstRes = await app.inject({
      method: 'POST',
      url: '/crawler/start',
      payload: { query: 'first' },
    });
    expect(firstRes.statusCode).toBe(200);
    expect(runCrawlerJobMock).toHaveBeenCalledTimes(1);
    expect(runCrawlerJobMock).toHaveBeenCalledWith('first', undefined);

    const second = await app.inject({
      method: 'POST',
      url: '/crawler/start',
      payload: { query: 'second' },
    });

    expect(second.statusCode).toBe(200);
    expect(runCrawlerJobMock).toHaveBeenCalledTimes(1);

    release();
    runCrawlerJobMock.mockImplementation(() =>
      new Promise<void>((resolve) => setImmediate(resolve)),
    );
    await app.close();
  });
});
