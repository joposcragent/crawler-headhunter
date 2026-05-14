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
