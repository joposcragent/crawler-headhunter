import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 38437;

describe('job-postings-client', () => {
  let server: http.Server;

  beforeAll(async () => {
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
  });
});
