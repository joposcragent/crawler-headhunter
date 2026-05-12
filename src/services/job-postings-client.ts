import axios from 'axios';
import { config } from '../config.js';

const client = axios.create({ baseURL: config.jobPostingsCrudUrl });

export async function getNonExistentUids(uids: string[]): Promise<string[]> {
  try {
    const response = await client.post<{ list: string[] }>(
      '/job-postings/search-query/non-existent',
      { list: uids },
    );
    return response.data.list;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

export interface VacancyPayload {
  uuid: string;
  uid: string;
  title: string;
  url: string;
  company: string;
  content: string;
  publicationDate: string;
  searchQueryUuid: string;
}

export async function saveVacancy(
  payload: VacancyPayload,
  options?: { correlationId?: string },
): Promise<boolean> {
  const cid = options?.correlationId?.trim() ?? '';
  const requestConfig =
    cid.length > 0 ? { headers: { 'X-Joposcragent-correlationId': cid } } : {};
  try {
    await client.post(
      `/job-postings/${payload.uuid}`,
      {
        uuid: payload.uuid,
        uid: payload.uid,
        title: payload.title,
        url: payload.url,
        company: payload.company,
        content: payload.content,
        publicationDate: payload.publicationDate,
        searchQueryUuid: payload.searchQueryUuid,
      },
      requestConfig,
    );
    return true;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      return false;
    }
    throw error;
  }
}
