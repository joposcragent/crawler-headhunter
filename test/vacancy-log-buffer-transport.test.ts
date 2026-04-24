import { describe, expect, it } from 'vitest';
import { createVacancyLogCapture } from '../src/logging/vacancy-log-buffer-transport.js';
import { createServiceLogger } from '../src/logger.js';

describe('createVacancyLogCapture', () => {
  it('buffers lines while active and clears on takeAndClear', async () => {
    const cap = createVacancyLogCapture();
    const log = createServiceLogger('[vac]', {
      extraTransports: [cap.transport],
    });
    cap.begin();
    log.info('one');
    log.info('two');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const text = cap.takeAndClear();
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(cap.takeAndClear()).toBe('');
  });

  it('does not buffer when inactive', () => {
    const cap = createVacancyLogCapture();
    const log = createServiceLogger('[vac2]', {
      extraTransports: [cap.transport],
    });
    log.info('ignored');
    expect(cap.takeAndClear()).toBe('');
  });
});
