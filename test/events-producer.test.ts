import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { createEventsProducer } from '../src/services/events-producer.js';

function mockClient(postImpl: ReturnType<typeof vi.fn>): AxiosInstance {
  return { post: postImpl } as unknown as AxiosInstance;
}

describe('createEventsProducer', () => {
  it('does not POST when correlationId is empty', async () => {
    const post = vi.fn();
    const p = createEventsProducer('   ', { client: mockClient(post) });
    await p.sendVacancyProgress({
      createdAt: '2025-01-01T00:00:00.000Z',
      executionLog: 'log',
      jobPostingUuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'SUCCEEDED',
    });
    await p.sendPageProcessedProgress({ currentPage: 1, totalPages: 3 });
    await p.sendFinish({
      jobError: null,
      pagesProcessed: 1,
      newVacanciesSaved: 0,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('does not POST page progress when only one page', async () => {
    const post = vi.fn().mockResolvedValue({ status: 204 });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440001', {
      client: mockClient(post),
    });
    await p.sendPageProcessedProgress({ currentPage: 1, totalPages: 1 });
    expect(post).not.toHaveBeenCalled();
  });

  it('POSTs vacancy progress when correlation is set', async () => {
    const post = vi.fn().mockResolvedValue({ status: 204 });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440002', {
      client: mockClient(post),
    });
    await p.sendVacancyProgress({
      createdAt: '2025-01-02T00:00:00.000Z',
      executionLog: 'line1',
      jobPostingUuid: '550e8400-e29b-41d4-a716-446655440099',
      status: 'FAILED',
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/events-queue/progress');
    expect(post.mock.calls[0][1]).toMatchObject({
      correlationId: '550e8400-e29b-41d4-a716-446655440002',
      createdAt: '2025-01-02T00:00:00.000Z',
      executionLog: 'line1',
      jobPostingUuid: '550e8400-e29b-41d4-a716-446655440099',
      status: 'FAILED',
    });
  });

  it('POSTs page progress when multiple pages', async () => {
    const post = vi.fn().mockResolvedValue({ status: 204 });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440003', {
      client: mockClient(post),
    });
    await p.sendPageProcessedProgress({ currentPage: 2, totalPages: 5 });
    expect(post).toHaveBeenCalledWith(
      '/events-queue/progress',
      expect.objectContaining({
        correlationId: '550e8400-e29b-41d4-a716-446655440003',
        executionLog: 'Обработана страница 2 из 5',
      }),
      expect.any(Object),
    );
  });

  it('POSTs finish SUCCEEDED with summary result', async () => {
    const post = vi.fn().mockResolvedValue({ status: 204 });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440004', {
      client: mockClient(post),
    });
    await p.sendFinish({
      jobError: null,
      pagesProcessed: 3,
      newVacanciesSaved: 7,
    });
    expect(post).toHaveBeenCalledWith(
      '/events-queue/finish',
      expect.objectContaining({
        status: 'SUCCEEDED',
        result:
          'Обработано страниц 3, загружено 7 новых вакансий',
      }),
      expect.any(Object),
    );
  });

  it('POSTs finish FAILED with error fields', async () => {
    const post = vi.fn().mockResolvedValue({ status: 204 });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440005', {
      client: mockClient(post),
    });
    const err = new Error('boom');
    err.stack = 'stack-trace';
    await p.sendFinish({
      jobError: err,
      pagesProcessed: 0,
      newVacanciesSaved: 0,
    });
    expect(post).toHaveBeenCalledWith(
      '/events-queue/finish',
      expect.objectContaining({
        status: 'FAILED',
        result: 'boom',
        executionLog: 'stack-trace',
      }),
      expect.any(Object),
    );
  });

  it('logs and swallows non-204 responses without throwing', async () => {
    const post = vi.fn().mockResolvedValue({ status: 500, data: 'no' });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440006', {
      client: mockClient(post),
    });
    await expect(
      p.sendFinish({
        jobError: null,
        pagesProcessed: 1,
        newVacanciesSaved: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('logs and swallows network errors without throwing', async () => {
    const post = vi.fn().mockRejectedValue(new Error('network'));
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440007', {
      client: mockClient(post),
    });
    await expect(
      p.sendFinish({
        jobError: null,
        pagesProcessed: 0,
        newVacanciesSaved: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('formats non-Error jobError for finish', async () => {
    const post = vi.fn().mockResolvedValue({ status: 204 });
    const p = createEventsProducer('550e8400-e29b-41d4-a716-446655440008', {
      client: mockClient(post),
    });
    await p.sendFinish({
      jobError: 404,
      pagesProcessed: 0,
      newVacanciesSaved: 0,
    });
    expect(post.mock.calls[0][1]).toMatchObject({
      result: '404',
      executionLog: '404',
    });
  });
});
