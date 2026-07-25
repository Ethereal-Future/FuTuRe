import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const ACCESS_TOKEN_KEY = 'accessToken';
const CORRELATION_ID_KEY = 'correlationId';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: true,
});

function getAccessToken() {
  return typeof window !== 'undefined' ? localStorage.getItem(ACCESS_TOKEN_KEY) : null;
}

function setAccessToken(token) {
  if (typeof window !== 'undefined' && token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  }
}

function getCorrelationId() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(CORRELATION_ID_KEY) || null;
}

function ensureCorrelationId() {
  if (typeof window === 'undefined') return null;
  let correlationId = getCorrelationId();
  if (!correlationId) {
    correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem(CORRELATION_ID_KEY, correlationId);
  }
  return correlationId;
}

async function refreshAccessToken() {
  const response = await apiClient.post('/api/auth/refresh');
  const accessToken = response.data?.accessToken;
  if (accessToken) {
    setAccessToken(accessToken);
  }
  return accessToken;
}

function normalizeAxiosError(error) {
  const responseError = error.response?.data?.error;
  const normalized = {
    message: (typeof responseError === 'object' ? responseError?.message : responseError) || error.message || 'Request failed',
    code: typeof responseError === 'object' ? responseError?.code : null,
    status: error.response?.status,
    data: error.response?.data,
  };

  if (error.normalized) {
    Object.assign(error.normalized, normalized);
  } else {
    error.normalized = normalized;
  }

  return error;
}

apiClient.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  const accessToken = getAccessToken();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  const correlationId = ensureCorrelationId();
  if (correlationId) {
    config.headers['X-Correlation-ID'] = correlationId;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Map 503 and 429 to user-friendly messages before the 401-retry logic
    const status = error.response?.status;
    if (status === 503) {
      const friendly = new Error('The service is temporarily unavailable.');
      friendly.isNetworkError = true;
      friendly.status = 503;
      return Promise.reject(friendly);
    }
    if (status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'];
      const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
      const msg = seconds
        ? `Too many requests. Please wait ${seconds} second${seconds !== 1 ? 's' : ''}.`
        : 'Too many requests. Please try again later.';
      const friendly = new Error(msg);
      friendly.isNetworkError = true;
      friendly.status = 429;
      friendly.retryAfter = seconds;
      return Promise.reject(friendly);
    }

    // Network errors (no response)
    if (!error.response && !error.config?._retry) {
      if (error.code === 'ECONNABORTED' || error.message?.toLowerCase().includes('timeout')) {
        const friendly = new Error('The request took too long. Please try again.');
        friendly.isNetworkError = true;
        return Promise.reject(friendly);
      }
    }

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/api/auth/refresh')
    ) {
      originalRequest._retry = true;
      try {
        const newToken = await refreshAccessToken();
        if (newToken && originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        return Promise.reject(normalizeAxiosError(refreshError));
      }
    }

    return Promise.reject(normalizeAxiosError(error));
  },
);

export default apiClient;
