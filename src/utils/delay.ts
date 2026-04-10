import { config } from '../config.js';

export async function randomDelay(): Promise<void> {
  const { delayMinMs, delayMaxMs } = config;
  const ms = Math.floor(Math.random() * (delayMaxMs - delayMinMs + 1)) + delayMinMs;
  console.log(`[delay] Waiting ${ms}ms`);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
