import { config } from '../config.js';
import { createServiceLogger } from '../logger.js';

const logger = createServiceLogger('[delay]');

export async function randomDelay(): Promise<void> {
  const { delayMinMs, delayMaxMs } = config;
  const ms = Math.floor(Math.random() * (delayMaxMs - delayMinMs + 1)) + delayMinMs;
  logger.info(`Waiting ${ms}ms`);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
