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

export function stripHtml(html: string): string {
  const withSpaces = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&#x0*A0;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u00a0/g, ' ');
  return withSpaces.replace(/\s+/g, ' ').trim();
}

/** Full hh.ru query string (area=1&text=...) vs plain keywords for ?text= */
export function looksLikeUrlQueryString(q: string): boolean {
  return /^[a-zA-Z0-9_]+=/.test(q.trim());
}

export type SearchUrlConfig = {
  baseUrl: string;
  hhSearchUrl: string;
};

export function buildSearchUrl(query: string, cfg: SearchUrlConfig): string {
  const q = query.trim();
  if (looksLikeUrlQueryString(q)) {
    const base = cfg.baseUrl.replace(/\/$/, '');
    return `${base}/search/vacancy?${q}`;
  }
  return `${cfg.hhSearchUrl}${encodeURIComponent(q)}`;
}

/** YYYY-MM-DD for job-postings-crud (OpenAPI date-time / DB varchar). */
export function parsePublicationDateIso(bodyText: string): string {
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
