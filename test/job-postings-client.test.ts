import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 38437;

let lastPostHeaders: http.IncomingHttpHeaders | null = null;

describe('job-postings-client', () => {
  let server: http.Server;

  beforeAll(async () => {
    lastPostHeaders = null;
    server = http.createServer((req, res) => {
      const bodyChunks: Buffer[] = [];
      req.on('data', (c) => bodyChunks.push(c));
      req.on('end', () => {
        if (
          req.url === '/job-postings/search-query/non-existent' &&
          req.method === 'POST'
        ) {
          const raw = Buffer.concat(bodyChunks).toString();
          if (raw.includes('FORCE404')) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ list: ['new-1'] }));
          return;
        }
        if (req.url?.startsWith('/job-postings/') && req.method === 'POST') {
          lastPostHeaders = { ...req.headers };
          res.writeHead(201);
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('getNonExistentUids returns list from API', async () => {
    const { getNonExistentUids } = await import('../src/services/job-postings-client.js');
    const list = await getNonExistentUids(['a', 'b']);
    expect(list).toEqual(['new-1']);
  });

  it('getNonExistentUids returns empty array on HTTP 404', async () => {
    const { getNonExistentUids } = await import('../src/services/job-postings-client.js');
    const list = await getNonExistentUids(['FORCE404']);
    expect(list).toEqual([]);
  });

  it('saveVacancy posts payload', async () => {
    const { saveVacancy } = await import('../src/services/job-postings-client.js');
    await expect(
      saveVacancy({
        uuid: '550e8400-e29b-41d4-a716-446655440010',
        uid: 'u1',
        title: 't',
        url: 'http://x',
        company: 'c',
        content: 'body',
        publicationDate: '2025-01-01',
      }),
    ).resolves.toBeUndefined();
    expect(lastPostHeaders?.['x-joposcragent-correlationid']).toBeUndefined();
  });

  it('saveVacancy sends X-Joposcragent-correlationId when correlationId is set', async () => {
    const { saveVacancy } = await import('../src/services/job-postings-client.js');
    const cid = '550e8400-e29b-41d4-a716-446655440099';
    await saveVacancy(
      {
        uuid: '550e8400-e29b-41d4-a716-446655440011',
        uid: 'u2',
        title: 't2',
        url: 'http://y',
        company: 'c2',
        content: 'b2',
        publicationDate: '2025-02-02',
      },
      { correlationId: cid },
    );
    expect(lastPostHeaders?.['x-joposcragent-correlationid']).toBe(cid);
  });
});
