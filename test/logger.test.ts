import { describe, expect, it } from 'vitest';
import { createServiceLogger } from '../src/logger.js';

describe('createServiceLogger', () => {
  it('creates a logger that accepts log calls', () => {
    const log = createServiceLogger('[test]');
    expect(() => {
      log.info('hello');
      log.error('err');
    }).not.toThrow();
  });
});
