import axios from 'axios';

// Configure axios with API v1 base URL
axios.defaults.baseURL = '/api/v1';

// Add correlation ID header to all requests
axios.interceptors.request.use((config) => {
  const correlationId = sessionStorage.getItem('correlationId') || 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  sessionStorage.setItem('correlationId', correlationId);
  config.headers['X-Correlation-ID'] = correlationId;
  return config;
});

export default axios;
