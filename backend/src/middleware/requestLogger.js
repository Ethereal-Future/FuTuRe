import { randomUUID } from 'crypto';
import logger from '../config/logger.js';
import { createRequestAbortSignal, runWithRequestContext } from '../db/requestContext.js';

export function requestLogger(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  const startAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = parseFloat((Number(process.hrtime.bigint() - startAt) / 1e6).toFixed(2));
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('http', {
      correlationId,
      method: req.method,
      path: req.path,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      contentLength: res.getHeader('content-length') ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  });

  // Expose an AbortSignal that fires if the client disconnects before the
  // response completes, and bind it to the async context so database helpers
  // (db/client.js) can stop issuing queries and roll back transactions.
  if (!req.signal) {
    Object.defineProperty(req, 'signal', {
      value: createRequestAbortSignal(req, res),
      configurable: true,
    });
  }

  req.signal.addEventListener(
    'abort',
    () => logger.warn('http.client.aborted', { correlationId, method: req.method, url: req.originalUrl }),
    { once: true }
  );

  runWithRequestContext({ signal: req.signal, correlationId }, next);
}
