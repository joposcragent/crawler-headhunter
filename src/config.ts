import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  port: parseInt(optional('PORT', '8080'), 10),

  baseUrl: optional('BASE_URL', 'https://hh.ru'),
  hhSearchUrl: optional('HH_SEARCH_URL', 'https://hh.ru/search/vacancy?'),
  jobPostingsCrudUrl: optional('JOB_POSTINGS_CRUD_URL', 'http://job-postings-crud:8080'),

  delayMinMs: parseInt(optional('DELAY_MIN_MS', '4000'), 10),
  delayMaxMs: parseInt(optional('DELAY_MAX_MS', '37000'), 10),

  userAgent: optional(
    'USER_AGENT',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  ),
  viewportWidth: parseInt(optional('VIEWPORT_WIDTH', '1920'), 10),
  viewportHeight: parseInt(optional('VIEWPORT_HEIGHT', '1080'), 10),
  locale: optional('LOCALE', 'ru-RU'),
  timezone: optional('TIMEZONE', 'Europe/Moscow'),
  navigatorLanguages: optional('NAVIGATOR_LANGUAGES', 'ru-RU,ru,en-US,en'),

  selectorVacancyListPagesLinks: optional(
    'SELECTOR_VACANCY_LIST_PAGES_LINKS',
    'ul[class^="magritte-number-pages-container"]>li>div>a',
  ),
  selectorVacancyListCards: optional(
    'SELECTOR_VACANCY_LIST_CARDS',
    'div[id][class^="vacancy-card"]',
  ),
  selectorVacancyListCardTitle: optional(
    'SELECTOR_VACANCY_LIST_CARD_TITLE',
    'span[data-qa="serp-item__title-text"]',
  ),
  selectorVacancyListCardCompany: optional(
    'SELECTOR_VACANCY_LIST_CARD_COMPANY',
    'span[data-qa="vacancy-serp__vacancy-employer-text"]',
  ),
  headless: optional('BROWSER_HEADLESS', 'true') !== 'false',

  selectorVacancyCardContent: optional(
    'SELECTOR_VACANCY_CARD_CONTENT',
    'div[data-qa="vacancy-description"]',
  ),
} as const;
