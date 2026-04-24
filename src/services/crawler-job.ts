import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { createVacancyLogCapture } from '../logging/vacancy-log-buffer-transport.js';
import { createServiceLogger } from '../logger.js';
import { createBrowser, createContext } from '../utils/browser.js';
import { randomDelay } from '../utils/delay.js';
import { createEventsProducer } from './events-producer.js';
import { getNonExistentUids, saveVacancy } from './job-postings-client.js';
import {
  buildSearchUrl,
  parsePublicationDateIso,
  stripHtml,
} from './hh-crawl-helpers.js';

const vacancyLogCapture = createVacancyLogCapture();
const logger = createServiceLogger('[crawler]', {
  extraTransports: [vacancyLogCapture.transport],
});

interface CardData {
  uid: string;
  title: string;
  company: string;
  url: string;
}

const NAV_WAIT_UNTIL = 'domcontentloaded' as const;

export async function runCrawlerJob(
  searchQuery: string,
  correlationId?: string,
): Promise<void> {
  const events = createEventsProducer(correlationId);
  let jobError: unknown | null = null;
  let pagesProcessed = 0;
  let savedCount = 0;

  logger.info(`Job started for search query: "${searchQuery}"`);
  const browser = await createBrowser();

  try {
    try {
      const context = await createContext(browser);
      const page = await context.newPage();

      try {
        const searchUrl = buildSearchUrl(searchQuery, {
          baseUrl: config.baseUrl,
          hhSearchUrl: config.hhSearchUrl,
        });
        await page.goto(searchUrl, { waitUntil: NAV_WAIT_UNTIL });
        await randomDelay();

        const pageHrefs = await page
          .$$eval(config.selectorVacancyListPagesLinks, (els) =>
            els.map((el) => el.getAttribute('href') ?? ''),
          )
          .catch(() => [] as string[]);

        const additionalPages = pageHrefs
          .filter(Boolean)
          .map((href) => `${config.baseUrl}${href}`);

        logger.info(
          `Found ${additionalPages.length} additional page(s) for query: "${searchQuery}"`,
        );

        const allPageUrls: Array<string | null> = [null, ...additionalPages.slice(1)];

        let breakPageLoop = false;

        for (let pageIndex = 0; pageIndex < allPageUrls.length; pageIndex++) {
          if (breakPageLoop) {
            break;
          }

          const pageUrl = allPageUrls[pageIndex];

          try {
            if (pageUrl !== null) {
              logger.info(`Navigating to next page: ${pageUrl}`);
              await page.goto(pageUrl, { waitUntil: NAV_WAIT_UNTIL });
              await randomDelay();
            }

            const cards = await page
              .$$eval(
                config.selectorVacancyListCards,
                (
                  els,
                  args: { titleSel: string; companySel: string; baseUrl: string },
                ) =>
                  els.map((el) => ({
                    uid: el.id,
                    title:
                      el.querySelector(args.titleSel)?.textContent?.trim() ?? '',
                    company:
                      el.querySelector(args.companySel)?.textContent?.trim() ??
                      '',
                    url: `${args.baseUrl}/vacancy/${el.id}`,
                  })),
                {
                  titleSel: config.selectorVacancyListCardTitle,
                  companySel: config.selectorVacancyListCardCompany,
                  baseUrl: config.baseUrl,
                },
              )
              .catch(() => [] as CardData[]);

            const uids = cards.map((c) => c.uid).filter(Boolean);

            if (uids.length === 0) {
              logger.info('No vacancy cards found on page, stopping');
              break;
            }

            logger.info(`Found ${uids.length} vacancy cards on page`);

            let newUids: string[];
            try {
              newUids = await getNonExistentUids(uids);
            } catch (error) {
              logger.info('Error checking non-existent uids', { error });
              jobError = error;
              break;
            }

            if (newUids.length === 0) {
              logger.info(
                'All uids already in DB — stopping page loop for this query',
              );
              breakPageLoop = true;
              break;
            }

            logger.info(`${newUids.length} new vacancy(ies) to save`);

            const newCards = cards.filter((c) => newUids.includes(c.uid));
            const totalCards = newCards.length;

            for (const [index, card] of newCards.entries()) {
              vacancyLogCapture.begin();
              const jobPostingUuid = uuidv4();
              let vacancyFetchStatus: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED';
              try {
                logger.info(
                  `Fetching vacancy: ${index + 1} of ${totalCards}: ${card.uid} "${card.title}"`,
                );
                await page.goto(card.url, { waitUntil: NAV_WAIT_UNTIL });
                await randomDelay();

                const contentHtml = await page
                  .$eval(config.selectorVacancyCardContent, (el) => el.innerHTML)
                  .catch(() => '');
                const content = stripHtml(contentHtml);

                const bodyText: string = await page.evaluate(
                  () => (document.body as HTMLElement).innerText,
                );
                const publicationDate = parsePublicationDateIso(bodyText);
                await saveVacancy(
                  {
                    uuid: jobPostingUuid,
                    uid: card.uid,
                    title: card.title,
                    url: card.url,
                    company: card.company,
                    content,
                    publicationDate,
                  },
                  { correlationId },
                );

                savedCount += 1;
                logger.info(`Saved vacancy: ${card.uid}`);
              } catch (error) {
                logger.info(`Error on vacancy ${card.uid}, skipping`, { error });
                vacancyFetchStatus = 'FAILED';
              }

              const executionLog = vacancyLogCapture.takeAndClear();
              const createdAt = new Date().toISOString();
              await events.sendVacancyProgress({
                createdAt,
                executionLog,
                jobPostingUuid,
                status: vacancyFetchStatus,
              });
            }
          } finally {
            pagesProcessed += 1;
            await events.sendPageProcessedProgress({
              currentPage: pageIndex + 1,
              totalPages: allPageUrls.length,
            });
          }
        }
      } catch (error) {
        jobError = error;
        logger.info(`Error on query "${searchQuery}", skipping`, { error });
      }
    } catch (error) {
      jobError = error;
      logger.info('Crawler setup or run failed', { error });
    } finally {
      await events.sendFinish({
        jobError,
        pagesProcessed,
        newVacanciesSaved: savedCount,
      });
    }
  } finally {
    logger.info('Job complete, closing browser');
    await browser.close();
  }
}
