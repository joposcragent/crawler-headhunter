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

  it('passes correlation header and runId to runCrawlerJob', async () => {
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
    expect(runCrawlerJobMock).toHaveBeenCalledWith(
      'python',
      'corr-uuid-1',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
    await app.close();
  });

  it('starts a second job while the first is still running', async () => {
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
    expect(runCrawlerJobMock).toHaveBeenCalledWith(
      'first',
      undefined,
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );

    const second = await app.inject({
      method: 'POST',
      url: '/crawler/start',
      payload: { query: 'second' },
    });

    expect(second.statusCode).toBe(200);
    expect(runCrawlerJobMock).toHaveBeenCalledTimes(2);
    expect(runCrawlerJobMock).toHaveBeenNthCalledWith(
      2,
      'second',
      undefined,
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
    expect(runCrawlerJobMock.mock.calls[0][2]).not.toBe(runCrawlerJobMock.mock.calls[1][2]);

    release();
    runCrawlerJobMock.mockImplementation(() =>
      new Promise<void>((resolve) => setImmediate(resolve)),
    );
    await app.close();
  });
});
