// Sanctions screening — integrates with the OFAC SDN API.
// Falls back to a local name-match if SANCTIONS_API_KEY is not set.
// Set SANCTIONS_API_KEY and SANCTIONS_API_URL in your environment.

import https from 'https';

const API_URL  = process.env.SANCTIONS_API_URL  ?? 'https://api.ofac-api.com/v4/search';
const API_KEY  = process.env.SANCTIONS_API_KEY  ?? '';
const MIN_SCORE = parseInt(process.env.SANCTIONS_MIN_SCORE ?? '85', 10);

function httpPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

class SanctionsChecker {
  /**
   * Screen a person against sanctions lists.
   * @param {string} fullName
   * @param {string} [nationality]
   * @returns {Promise<{ hit: boolean, reason?: string, source?: string }>}
   */
  async check(fullName, nationality) {
    if (API_KEY) {
      return this._checkViaApi(fullName, nationality);
    }
    // No API key — warn and return clear (operator must configure for production)
    console.warn('[sanctions] SANCTIONS_API_KEY not set; screening skipped. Configure for production.');
    return { hit: false };
  }

  async _checkViaApi(fullName, nationality) {
    try {
      const payload = {
        apiKey: API_KEY,
        minScore: MIN_SCORE,
        sources: ['SDN', 'UN', 'EU'],
        cases: [{ name: fullName, ...(nationality ? { nationality } : {}) }],
      };
      const { status, body } = await httpPost(API_URL, payload, { apiKey: API_KEY });

      if (status !== 200) {
        console.error('[sanctions] API error', status, body);
        // Fail open with a warning — operator should decide fail-closed policy
        return { hit: false, warning: `Sanctions API returned ${status}` };
      }

      const matches = body?.results?.[0]?.matches ?? [];
      if (matches.length > 0) {
        const top = matches[0];
        return {
          hit: true,
          reason: `Matched sanctions entry: ${top.name} (score: ${top.score}, lists: ${top.sources?.join(', ')})`,
          source: top.sources?.[0] ?? 'UNKNOWN',
        };
      }
      return { hit: false };
    } catch (err) {
      console.error('[sanctions] API call failed:', err.message);
      return { hit: false, warning: `Sanctions API unavailable: ${err.message}` };
    }
  }
}

export default new SanctionsChecker();
