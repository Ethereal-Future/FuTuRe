import { recordRequest } from './metrics.js';

/**
 * Express middleware that records response time and error status for every request.
 */
export function performanceMiddleware(req, res, next) {
  const start = performance.now();

  res.on('finish', () => {
    const durationMs = +(performance.now() - start).toFixed(2);
    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const isError = res.statusCode >= 500;
    recordRequest(route, durationMs, isError);
  });

  next();
}
