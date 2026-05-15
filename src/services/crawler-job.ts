import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { createServiceLogger } from '../logger.js';
import { createBrowser, createContext } from '../utils/browser.js';
import { randomDelay } from '../utils/delay.js';
import { getNonExistentUids } from './job-postings-client.js';
import {
  publishCollectionQueryCanceled,
  publishCollectionQueryFailed,
  publishCollectionQuerySucceeded,
  publishJobPostingCreateBegin,
} from './orchestration-kafka.js';
import {
  buildSearchUrl,
  parsePublicationDateIso,
  stripHtml,
} from './hh-crawl-helpers.js';

interface CardData {
  uid: string;
  title: string;
  company: string;
  url: string;
}

const NAV_WAIT_UNTIL = 'domcontentloaded' as const;

function formatErrorBrief(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** RFC 3339 `date-time` for Kafka payloads (from `YYYY-MM-DD` or ISO). */
function publicationDateToDateTime(isoOrDay: string): string {
  const t = isoOrDay.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return `${t}T12:00:00.000Z`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString();
  }
  return new Date().toISOString();
}

async function sendFinalCollectionResult(
  log: ReturnType<typeof createServiceLogger>,
  options: {
    correlationId: string | undefined;
    jobError: unknown | null;
    pagesProcessed: number;
    newVacanciesSaved: number;
    sawAnyVacancyCards: boolean;
  },
): Promise<void> {
  const cid = options.correlationId?.trim();
  if (!cid) {
    return;
  }
  try {
    if (options.jobError != null) {
      await publishCollectionQueryFailed({
        messageKey: cid,
        errorMessage: formatErrorBrief(options.jobError),
        pagesProcessed: options.pagesProcessed,
        newVacanciesSaved: options.newVacanciesSaved,
      });
    } else if (options.newVacanciesSaved === 0) {
      const result = options.sawAnyVacancyCards
        ? 'Вакансии по запросу есть, но новых для сохранения нет.'
        : 'По запросу не найдено ни одной вакансии.';
      await publishCollectionQueryCanceled({
        collectionJobUuid: cid,
        pagesProcessed: options.pagesProcessed,
        newVacanciesSaved: 0,
        result,
      });
    } else {
      await publishCollectionQuerySucceeded({
        collectionJobUuid: cid,
        pagesProcessed: options.pagesProcessed,
        newVacanciesSaved: options.newVacanciesSaved,
      });
    }
  } catch (error: unknown) {
    log.info('Kafka collection-query-result failed', { error });
  }
}

export async function runCrawlerJob(
  searchQuery: string,
  searchQueryUuid: string,
  correlationId: string | undefined,
  runId: string,
  lazy = false,
): Promise<void> {
  const logger = createServiceLogger(`[crawler][${runId}]`);
  let jobError: unknown | null = null;
  let pagesProcessed = 0;
  let savedCount = 0;
  let sawAnyVacancyCards = false;
  let browser: Awaited<ReturnType<typeof createBrowser>> | null = null;

  logger.info(`Job started for search query: "${searchQuery}"`);

  try {
    try {
      browser = await createBrowser(runId);
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

        for (let pageIndex = 0; pageIndex < allPageUrls.length; pageIndex++) {
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

            sawAnyVacancyCards = true;
            logger.info(`Found ${uids.length} vacancy cards on page`);

            let newUids: string[];
            try {
              newUids = await getNonExistentUids(uids);
            } catch (error) {
              logger.info('Error checking non-existent uids', { error });
              jobError = error;
              break;
            }

            if (newUids.length === 0 && lazy) {
              logger.info(
                'All uids on page already in DB — stopping page loop (lazy=true)',
              );
              break;
            }

            if (newUids.length === 0) {
              logger.info(
                'All uids on page already in DB — continuing page loop (lazy=false)',
              );
            } else {
              logger.info(`${newUids.length} new vacancy(ies) to publish`);
            }

            const newCards = cards.filter((c) => newUids.includes(c.uid));
            const totalCards = newCards.length;

            for (const [index, card] of newCards.entries()) {
              const jobPostingUuid = uuidv4();
              const currentJobUuid = uuidv4();
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
                const publicationDay = parsePublicationDateIso(bodyText);
                const publicationDate = publicationDateToDateTime(publicationDay);

                await publishJobPostingCreateBegin({
                  currentJobUuid,
                  jobPostingUuid,
                  parentJobUuid: correlationId?.trim() || undefined,
                  searchQueryUuid,
                  uid: card.uid,
                  title: card.title,
                  url: card.url,
                  company: card.company,
                  content,
                  publicationDate,
                });
                savedCount += 1;
                logger.info(`Published job-posting-create-begin: ${card.uid}`);
              } catch (error) {
                logger.info(`Error on vacancy ${card.uid}, skipping`, { error });
              }
            }
          } finally {
            pagesProcessed += 1;
          }
        }
      } catch (error) {
        jobError = error;
        logger.info(`Error on query "${searchQuery}", skipping`, { error });
      }
    } catch (error) {
      jobError = error;
      logger.info('Crawler setup or run failed', { error });
    }
  } finally {
    if (browser !== null) {
      logger.info('Job complete, closing browser');
      try {
        await browser.close();
      } catch (error: unknown) {
        logger.info('Browser close failed', { error });
      }
    }
    await sendFinalCollectionResult(logger, {
      correlationId,
      jobError,
      pagesProcessed,
      newVacanciesSaved: savedCount,
      sawAnyVacancyCards,
    });
  }
}
