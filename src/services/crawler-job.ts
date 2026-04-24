import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { createVacancyLogCapture } from '../logging/vacancy-log-buffer-transport.js';
import { createServiceLogger } from '../logger.js';
import { createBrowser, createContext } from '../utils/browser.js';
import { randomDelay } from '../utils/delay.js';
import { getNonExistentUids, saveVacancy } from './job-postings-client.js';

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

function stripHtml(html: string): string {
  const withSpaces = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&#x0*A0;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ');
  return withSpaces.replace(/\s+/g, ' ').trim();
}

const RU_MONTHS: Record<string, string> = {
  января: '01',
  февраля: '02',
  марта: '03',
  апреля: '04',
  мая: '05',
  июня: '06',
  июля: '07',
  августа: '08',
  сентября: '09',
  октября: '10',
  ноября: '11',
  декабря: '12',
};

/** YYYY-MM-DD for job-postings-crud (OpenAPI date-time / DB varchar). */
function parsePublicationDateIso(bodyText: string): string {
  const m = bodyText.match(/Вакансия опубликована\s+(\d+)\s+([а-яёА-ЯЁ]+)\s+(\d{4})/);
  if (!m) {
    return new Date().toISOString().slice(0, 10);
  }
  const day = m[1].padStart(2, '0');
  const month = RU_MONTHS[m[2].toLowerCase()];
  const year = m[3];
  if (!month) {
    return new Date().toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

/** Full hh.ru query string (area=1&text=...) vs plain keywords for ?text= */
function looksLikeUrlQueryString(q: string): boolean {
  return /^[a-zA-Z0-9_]+=/.test(q.trim());
}

function buildSearchUrl(query: string): string {
  const q = query.trim();
  if (looksLikeUrlQueryString(q)) {
    const base = config.baseUrl.replace(/\/$/, '');
    return `${base}/search/vacancy?${q}`;
  }
  return `${config.hhSearchUrl}${encodeURIComponent(q)}`;
}

const NAV_WAIT_UNTIL = 'domcontentloaded' as const;

export async function runCrawlerJob(searchQuery: string): Promise<void> {
  logger.info(`Job started for search query: "${searchQuery}"`);
  const browser = await createBrowser();

  try {
    const context = await createContext(browser);
    const page = await context.newPage();

    try {
      const searchUrl = buildSearchUrl(searchQuery);
      await page.goto(searchUrl, { waitUntil: NAV_WAIT_UNTIL });
      await randomDelay();

      // Collect pagination links from first (already loaded) page
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

      // allPageUrls: null = already-loaded first page; additionalPages[0] is a link to that
      // same first page (HH.ru includes it in pagination), so we skip it with slice(1)
      const allPageUrls: Array<string | null> = [null, ...additionalPages.slice(1)];

      let breakPageLoop = false;

      for (const pageUrl of allPageUrls) {
        if (breakPageLoop) break;

        if (pageUrl !== null) {
          logger.info(`Navigating to next page: ${pageUrl}`);
          await page.goto(pageUrl, { waitUntil: NAV_WAIT_UNTIL });
          await randomDelay();
        }

        // Collect vacancy cards from current page
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

        // Filter to only uids not yet in DB
        let newUids: string[];
        try {
          newUids = await getNonExistentUids(uids);
        } catch (error) {
          logger.info('Error checking non-existent uids', { error });
          break;
        }

        if (newUids.length === 0) {
          logger.info('All uids already in DB — stopping page loop for this query');
          breakPageLoop = true;
          break;
        }

        logger.info(`${newUids.length} new vacancy(ies) to save`);

        const newCards = cards.filter((c) => newUids.includes(c.uid));
        const totalCards = newCards.length;

        for (const [index, card] of newCards.entries()) {
          vacancyLogCapture.begin();
          let vacancyFetchStatus: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED';
          try {
            logger.info(
              `Fetching vacancy: ${index + 1} of ${totalCards}: ${card.uid} "${card.title}"`,
            );
            await page.goto(card.url, { waitUntil: NAV_WAIT_UNTIL });
            await randomDelay();

            // Extract content and strip HTML tags
            const contentHtml = await page
              .$eval(config.selectorVacancyCardContent, (el) => el.innerHTML)
              .catch(() => '');
            const content = stripHtml(contentHtml);

            const bodyText: string = await page.evaluate(
              () => (document.body as HTMLElement).innerText,
            );
            const publicationDate = parsePublicationDateIso(bodyText);
            await saveVacancy({
              uuid: uuidv4(),
              uid: card.uid,
              title: card.title,
              url: card.url,
              company: card.company,
              content,
              publicationDate,
            });

            logger.info(`Saved vacancy: ${card.uid}`);
          } catch (error) {
            logger.info(`Error on vacancy ${card.uid}, skipping`, { error });
            // skip-and-continue
            vacancyFetchStatus = 'FAILED';
          }
          const vacancyLog = vacancyLogCapture.takeAndClear();
          // TODO: send vacancy log to Celery Orchestrator
        }
      }
    } catch (error) {
      logger.info(`Error on query "${searchQuery}", skipping`, { error });
    }
  } finally {
    logger.info('Job complete, closing browser');
    await browser.close();
  }
}
