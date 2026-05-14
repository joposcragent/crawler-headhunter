import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
    process.env.JOB_POSTINGS_CRUD_URL = `http://127.0.0.1:${PORT}`;
    vi.resetModules();
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
});
