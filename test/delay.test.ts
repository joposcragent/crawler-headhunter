import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('randomDelay', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after computed delay window', async () => {
    vi.doMock('../src/config.js', () => ({
      config: {
        delayMinMs: 10,
        delayMaxMs: 10,
      },
    }));
    const { randomDelay } = await import('../src/utils/delay.js');
    const p = randomDelay();
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBeUndefined();
  });
});
