import { generateSRIHash } from '../utils/sriHash.js';
import logger from '../config/logger.js';

const sriLogger = logger.child({ component: 'sri' });

/**
 * Middleware that generates and attaches SRI hashes to CDN assets
 * Useful for verifying asset integrity when served from a CDN
 */
export function sriHeadersMiddleware() {
  return (req, res, next) => {
    // Only process static asset responses
    if (!req.path.match(/\.(js|css)$/i)) {
      return next();
    }

    // Store original send method
    const originalSend = res.send;

    res.send = function (data) {
      // Generate SRI hash for the response body
      try {
        const integrity = generateSRIHash(data);
        res.setHeader('X-SRI-Hash', integrity);

        // For frontend integration, provide SRI hash in response headers
        // Frontend or CDN can use this to verify asset integrity
        sriLogger.debug('Generated SRI hash for asset', {
          path: req.path,
          hash: integrity,
          size: Buffer.byteLength(data),
        });
      } catch (err) {
        sriLogger.warn('Failed to generate SRI hash', {
          path: req.path,
          error: err.message,
        });
      }

      // Call original send
      return originalSend.call(this, data);
    };

    next();
  };
}

export default sriHeadersMiddleware;
