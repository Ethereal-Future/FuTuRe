import axios from 'axios';

/**
 * Shared axios instance with configurable base URL for production deployments.
 * Uses VITE_API_URL environment variable if set, otherwise defaults to relative paths.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  timeout: 30000,
});

export default apiClient;
