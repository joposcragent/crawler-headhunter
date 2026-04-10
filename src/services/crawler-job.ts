import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { createBrowser, createContext } from '../utils/browser.js';
import { randomDelay } from '../utils/delay.js';
import { getNonExistentUids, saveVacancy } from './job-postings-client.js';

interface CardData {
  uid: string;
  title: string;
  company: string;
  url: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function runCrawlerJob(searchQueries: string[]): Promise<void> {
  console.log(`[crawler] Job started with ${searchQueries.length} search queries`);
  const browser = await createBrowser();

  try {
    const context = await createContext(browser);
    const page = await context.newPage();

    for (const query of searchQueries) {
      console.log(`[crawler] Processing search query: "${query}"`);

      try {
        const searchUrl = `${config.hhSearchUrl}${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'load' });
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

        console.log(
          `[crawler] Found ${additionalPages.length} additional page(s) for query: "${query}"`,
        );

        // allPageUrls: null means "already loaded first page", rest are URLs to navigate to
        const allPageUrls: Array<string | null> = [null, ...additionalPages];

        let breakPageLoop = false;

        for (const pageUrl of allPageUrls) {
          if (breakPageLoop) break;

          if (pageUrl !== null) {
            console.log(`[crawler] Navigating to next page: ${pageUrl}`);
            await page.goto(pageUrl, { waitUntil: 'load' });
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
            console.log('[crawler] No vacancy cards found on page, stopping');
            break;
          }

          console.log(`[crawler] Found ${uids.length} vacancy cards on page`);

          // Filter to only uids not yet in DB
          let newUids: string[];
          try {
            newUids = await getNonExistentUids(uids);
          } catch (error) {
            console.log('[crawler] Error checking non-existent uids:', error);
            break;
          }

          if (newUids.length === 0) {
            console.log(
              '[crawler] All uids already in DB — stopping page loop for this query',
            );
            breakPageLoop = true;
            break;
          }

          console.log(`[crawler] ${newUids.length} new vacancy(ies) to save`);

          const newCards = cards.filter((c) => newUids.includes(c.uid));

          for (const card of newCards) {
            try {
              console.log(
                `[crawler] Fetching vacancy: ${card.uid} "${card.title}"`,
              );
              await page.goto(card.url, { waitUntil: 'load' });
              await randomDelay();

              // Extract content and strip HTML tags
              const contentHtml = await page
                .$eval(config.selectorVacancyCardContent, (el) => el.innerHTML)
                .catch(() => '');
              const content = stripHtml(contentHtml);

              // Extract publication date text from page body
              const bodyText: string = await page.evaluate(
                () => (document.body as HTMLElement).innerText,
              );
              const pubMatch = bodyText.match(
                /Вакансия опубликована \d+\s\w+\s\d+.*/,
              );
              const publicationDate = pubMatch ? pubMatch[0] : '';

              await saveVacancy({
                uuid: uuidv4(),
                uid: card.uid,
                title: card.title,
                url: card.url,
                company: card.company,
                content,
                publicationDate,
              });

              console.log(`[crawler] Saved vacancy: ${card.uid}`);
            } catch (error) {
              console.log(
                `[crawler] Error on vacancy ${card.uid}, skipping:`,
                error,
              );
              // skip-and-continue
            }
          }
        }
      } catch (error) {
        console.log(`[crawler] Error on query "${query}", skipping:`, error);
      }
    }
  } finally {
    console.log('[crawler] Job complete, closing browser');
    await browser.close();
  }
}
