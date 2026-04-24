import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';

describe('config', () => {
  it('exposes celery orchestrator URL', () => {
    expect(typeof config.celeryOrchestratorUrl).toBe('string');
    expect(config.celeryOrchestratorUrl.length).toBeGreaterThan(0);
  });

  it('exposes job postings URL', () => {
    expect(config.jobPostingsCrudUrl).toMatch(/^http/);
  });
});
