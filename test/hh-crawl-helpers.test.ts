import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  looksLikeUrlQueryString,
  parsePublicationDateIso,
  stripHtml,
} from '../src/services/hh-crawl-helpers.js';

const cfg = {
  baseUrl: 'https://hh.ru',
  hhSearchUrl: 'https://hh.ru/search/vacancy?',
};

describe('stripHtml', () => {
  it('removes tags and nbsp variants', () => {
    expect(stripHtml('<p>a&nbsp;</p>')).toBe('a');
    expect(stripHtml('&#160;x')).toBe('x');
    expect(stripHtml('a\u00a0b')).toBe('a b');
  });
});

describe('looksLikeUrlQueryString', () => {
  it('detects query-shaped strings', () => {
    expect(looksLikeUrlQueryString('area=1&text=java')).toBe(true);
    expect(looksLikeUrlQueryString('  area=1')).toBe(true);
    expect(looksLikeUrlQueryString('java developer')).toBe(false);
  });
});

describe('buildSearchUrl', () => {
  it('builds keyword search URL', () => {
    expect(buildSearchUrl('java dev', cfg)).toBe(
      'https://hh.ru/search/vacancy?java%20dev',
    );
  });

  it('uses full query when string looks like URL params', () => {
    expect(buildSearchUrl('text=go&area=2', cfg)).toBe(
      'https://hh.ru/search/vacancy?text=go&area=2',
    );
  });
});

describe('parsePublicationDateIso', () => {
  it('parses Russian month line', () => {
    const body = 'Вакансия опубликована 5 апреля 2025\nrest';
    expect(parsePublicationDateIso(body)).toBe('2025-04-05');
  });

  it('falls back to today when pattern missing', () => {
    const d = parsePublicationDateIso('no date here');
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back when month unknown', () => {
    const d = parsePublicationDateIso(
      'Вакансия опубликована 5 foobar 2025',
    );
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
