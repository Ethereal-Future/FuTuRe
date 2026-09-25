import { generateSRIHash } from '../utils/sriHash.js';
import logger from '../config/logger.js';

const sriLogger = logger.child({ component: 'sri' });

/**
 * ── Why this middleware does not (and cannot) enforce SRI ──────────────────
 *
 * Subresource Integrity is a browser feature that checks a hash embedded in
 * the HTML that *requests* a resource:
 *
 *   <script src="/assets/app.js" integrity="sha384-..." crossorigin></script>
 *
 * The browser hashes the response body and refuses to execute it if the hash
 * doesn't match the `integrity` attribute on the tag. Crucially, this check
 * happens on the *requesting* document, using a hash the browser already
 * had *before* the asset response arrived. A response header on the asset
 * itself (e.g. `X-SRI-Hash`) is never read by SRI enforcement — nothing in
 * the browser's fetch/script-loading pipeline consults response headers to
 * decide whether to execute a script. Setting one does not provide any
 * integrity guarantee; it previously gave a false sense of protection
 * (see #1121).
 *
 * The real fix is to serve the hash *out of band*, before the asset is
 * requested, so it can be embedded in the `integrity` attribute. That's what
 * `utils/sriManifest.js` + the `/api/assets/integrity` endpoint do — they
 * expose pre-computed sha384 hashes for the built frontend bundles so
 * server-rendered HTML (or a build step) can inject valid `integrity`
 * attributes.
 *
 * This middleware is kept only as a deprecated, opt-in diagnostic: it logs
 * the hash that *would* be embedded so operators can cross-check it against
 * the manifest endpoint. It intentionally no longer sets any response header
 * implying SRI compliance.
 */

/**
 * @deprecated Response headers cannot provide SRI protection — see module
 * doc comment. Use `getAssetIntegrityManifest()` / `GET /api/assets/integrity`
 * to obtain hashes for the `integrity` HTML attribute instead. This
 * middleware is retained only for diagnostic logging and does not set any
 * SRI-related header.
 */
export function sriHeadersMiddleware() {
  return (req, res, next) => {
    if (!req.path.match(/\.(js|css)$/i)) {
      return next();
    }

    const originalSend = res.send;
    res.send = function (data) {
      // Diagnostic only — logged for operators to cross-check against the
      // manifest endpoint. NOT a header; browsers never see this value and
      // it has no bearing on SRI enforcement.
      try {
        const wouldBeIntegrity = generateSRIHash(data, 'sha384');
        sriLogger.debug('sri.diagnostic.responseHash', {
          path: req.path,
          integrity: wouldBeIntegrity,
        });
      } catch (err) {
        sriLogger.warn('sri.diagnostic.hashFailed', { path: req.path, error: err.message });
      }
      return originalSend.call(this, data);
    };

    next();
  };
}

export default sriHeadersMiddleware;
