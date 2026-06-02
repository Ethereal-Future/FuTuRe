/**
 * Deprecation header middleware.
 *
 * Attach RFC 8594 Deprecation + Sunset headers to any endpoint that has been
 * marked for removal.  Usage:
 *
 *   import { deprecate } from '../middleware/deprecation.js';
 *
 *   router.get('/v1/old-endpoint',
 *     deprecate({ sunset: '2026-10-01', link: '/api/v2/new-endpoint' }),
 *     handler,
 *   );
 *
 * The `Deprecation` header is set to the ISO date on which the endpoint was
 * deprecated (defaults to today when first deployed).  `Sunset` is the
 * earliest date the endpoint may be removed — consumers must migrate by then.
 * `Link` points to the successor resource.
 *
 * Policy: a minimum 90-day notice period between the Deprecation date and the
 * Sunset date is enforced at startup (development only — skipped in test to
 * avoid clock drift issues).
 */

const MIN_NOTICE_DAYS = 90;

/**
 * Return Express middleware that adds Deprecation, Sunset, and Link headers.
 *
 * @param {object} options
 * @param {string} options.sunset - ISO date string (YYYY-MM-DD) on which the endpoint will be removed
 * @param {string} [options.deprecatedSince] - ISO date string when deprecation was announced (defaults to now)
 * @param {string} [options.link] - URL of the successor resource, used as the `Link` header value
 * @returns {import('express').RequestHandler}
 */
export function deprecate({ sunset, deprecatedSince, link } = {}) {
  if (!sunset) {
    throw new Error('deprecate() requires a `sunset` date');
  }

  const sunsetDate = new Date(sunset);
  if (isNaN(sunsetDate.getTime())) {
    throw new Error(`deprecate(): invalid sunset date "${sunset}"`);
  }

  const deprecatedDate = deprecatedSince ? new Date(deprecatedSince) : new Date();
  if (isNaN(deprecatedDate.getTime())) {
    throw new Error(`deprecate(): invalid deprecatedSince date "${deprecatedSince}"`);
  }

  if (process.env.APP_ENV !== 'test') {
    const noticeDays = (sunsetDate - deprecatedDate) / (1000 * 60 * 60 * 24);
    if (noticeDays < MIN_NOTICE_DAYS) {
      throw new Error(
        `deprecate(): sunset "${sunset}" is only ${Math.round(noticeDays)} days after ` +
        `deprecation "${deprecatedDate.toISOString().slice(0, 10)}" — minimum notice is ${MIN_NOTICE_DAYS} days`
      );
    }
  }

  const deprecationHeader = deprecatedDate.toISOString().slice(0, 10);
  const sunsetHeader = sunsetDate.toUTCString();

  return function deprecationMiddleware(_req, res, next) {
    res.setHeader('Deprecation', deprecationHeader);
    res.setHeader('Sunset', sunsetHeader);
    if (link) {
      res.setHeader('Link', `<${link}>; rel="successor-version"`);
    }
    next();
  };
}
