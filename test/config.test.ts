import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';

describe('config', () => {
  it('exposes Kafka bootstrap servers', () => {
    expect(typeof config.kafkaBootstrapServers).toBe('string');
    expect(config.kafkaBootstrapServers.length).toBeGreaterThan(0);
  });

  it('exposes Kafka consumer group id', () => {
    expect(config.kafkaConsumerGroupId).toMatch(/\S/);
  });

  it('exposes job postings URL', () => {
    expect(config.jobPostingsCrudUrl).toMatch(/^http/);
  });
});
