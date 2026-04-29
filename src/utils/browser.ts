import { chromium } from '@zorilla/playwright-extra';
import StealthPlugin from '@zorilla/puppeteer-extra-plugin-stealth';
import { config } from '../config.js';
import { createServiceLogger } from '../logger.js';

chromium.use(StealthPlugin());

export async function createBrowser(runId: string) {
  const logger = createServiceLogger(`[browser][${runId}]`);
  logger.info(`Launching Chromium with stealth plugin (headless=${config.headless})`);
  return chromium.launch({ headless: config.headless });
}

export async function createContext(browser: Awaited<ReturnType<typeof createBrowser>>) {
  return browser.newContext({
    userAgent: config.userAgent,
    viewport: { width: config.viewportWidth, height: config.viewportHeight },
    locale: config.locale,
    timezoneId: config.timezone,
    extraHTTPHeaders: {
      'Accept-Language': config.navigatorLanguages,
    },
  });
}
