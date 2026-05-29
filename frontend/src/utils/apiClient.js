import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

// Fetch and attach CSRF token to all requests
let csrfToken = null;

async function ensureCSRFToken() {
  if (!csrfToken) {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/csrf-token`, {
        withCredentials: true
      });
      csrfToken = response.data.csrfToken;
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
    }
  }
  return csrfToken;
}

// Request interceptor to attach CSRF token
apiClient.interceptors.request.use(async (config) => {
  // Only attach CSRF token for state-mutating requests
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method?.toUpperCase())) {
    const token = await ensureCSRFToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
});

// Response interceptor to refresh CSRF token on 403
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 && error.response?.data?.error?.includes('CSRF')) {
      // Reset token and retry
      csrfToken = null;
      const token = await ensureCSRFToken();
      if (token && error.config) {
        error.config.headers['X-CSRF-Token'] = token;
        return apiClient(error.config);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
