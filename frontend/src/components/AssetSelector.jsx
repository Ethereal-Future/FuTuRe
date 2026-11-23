import { useId, useMemo, useState } from 'react';

/**
 * AssetSelector — search and pick a Stellar asset (#1700).
 *
 * Multiple tokens can share the same asset code (e.g. several "USDC"
 * assets from different issuers, some of them scams). This selector:
 *   - matches the query against asset code, issuer public key and home domain,
 *     so users can paste a full 56-character issuer key to find an exact asset;
 *   - always shows a truncated issuer key next to the code so identical codes
 *     are distinguishable;
 *   - flags assets from known/verified issuers with a badge and sorts them first.
 *
 * Asset shape: { code: string, issuer?: string|null, domain?: string, verified?: boolean }
 * Native XLM is represented as { code: 'XLM', issuer: null }.
 */

/**
 * Well-known verified issuers, keyed by `${code}:${issuer}`. A badge is only
 * granted when BOTH the code and the issuer match, so a scam asset that
 * re-uses a popular code under a different issuer is never marked verified.
 */
export const VERIFIED_ISSUERS = {
  // Circle — USD Coin (mainnet)
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN': { domain: 'centre.io' },
};

const ISSUER_KEY_RE = /^G[A-Z2-7]{55}$/;

/** True if `value` looks like a full Stellar account public key. */
export function isIssuerKey(value) {
  return typeof value === 'string' && ISSUER_KEY_RE.test(value.trim().toUpperCase());
}

/** Shorten an issuer key for display, e.g. "GA5Z…KZVN". */
export function truncateIssuer(issuer, head = 4, tail = 4) {
  if (!issuer) return '';
  if (issuer.length <= head + tail + 1) return issuer;
  return `${issuer.slice(0, head)}…${issuer.slice(-tail)}`;
}

/** Stable identity for an asset — code alone is NOT unique. */
export function assetId(asset) {
  return asset.issuer ? `${asset.code}:${asset.issuer}` : asset.code;
}

/**
 * Whether an asset comes from a verified issuer. Native XLM is always
 * verified. An explicit `verified` flag on the asset is honoured, otherwise
 * the code+issuer pair is looked up in `verifiedIssuers`.
 */
export function isVerifiedAsset(asset, verifiedIssuers = VERIFIED_ISSUERS) {
  if (!asset) return false;
  if (!asset.issuer) return asset.code === 'XLM';
  if (asset.verified === true) return true;
  return Boolean(verifiedIssuers[`${asset.code}:${asset.issuer}`]);
}

/**
 * Filter assets by query, matching asset code, issuer public key and home
 * domain. A full issuer key returns only assets from that exact issuer.
 * Results are ordered: exact code matches, then verified, then the rest.
 */
export function filterAssets(assets, query, verifiedIssuers = VERIFIED_ISSUERS) {
  const list = Array.isArray(assets) ? assets : [];
  const q = (query ?? '').trim();
  const qUpper = q.toUpperCase();
  const qLower = q.toLowerCase();

  let matches;
  if (!q) {
    matches = list.slice();
  } else if (isIssuerKey(q)) {
    matches = list.filter((a) => (a.issuer ?? '').toUpperCase() === qUpper);
  } else {
    matches = list.filter(
      (a) =>
        a.code.toUpperCase().includes(qUpper) ||
        (a.issuer ?? '').toUpperCase().includes(qUpper) ||
        (a.domain ?? '').toLowerCase().includes(qLower),
    );
  }

  const rank = (a) =>
    (q && a.code.toUpperCase() === qUpper ? 0 : 2) + (isVerifiedAsset(a, verifiedIssuers) ? 0 : 1);
  return matches
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map(({ a }) => a);
}

export function AssetSelector({
  assets = [],
  value,
  onChange,
  verifiedIssuers = VERIFIED_ISSUERS,
  label = 'Asset',
  placeholder = 'Search by code, issuer key or domain',
}) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const listId = useId();

  const results = useMemo(
    () => filterAssets(assets, query, verifiedIssuers),
    [assets, query, verifiedIssuers],
  );

  // Codes that appear under more than one issuer in the current results.
  const ambiguousCodes = useMemo(() => {
    const counts = new Map();
    for (const a of results) counts.set(a.code, (counts.get(a.code) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([code]) => code));
  }, [results]);

  return (
    <div className="asset-selector">
      <label htmlFor={inputId} className="asset-selector__label">
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        className="asset-selector__search"
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
      />
      <ul id={listId} role="listbox" aria-label={`${label} results`} className="asset-selector__list">
        {results.length === 0 && (
          <li className="asset-selector__empty" role="option" aria-disabled="true" aria-selected="false">
            No matching assets
          </li>
        )}
        {results.map((asset) => {
          const id = assetId(asset);
          const verified = isVerifiedAsset(asset, verifiedIssuers);
          const selected = value === id;
          return (
            <li
              key={id}
              role="option"
              aria-selected={selected}
              tabIndex={0}
              className={`asset-selector__option${selected ? ' is-selected' : ''}`}
              data-asset-id={id}
              title={asset.issuer ?? 'Native asset'}
              onClick={() => onChange?.(id, asset)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange?.(id, asset);
                }
              }}
            >
              <span className="asset-selector__code">{asset.code}</span>
              <span className="asset-selector__issuer">
                {asset.issuer ? truncateIssuer(asset.issuer) : 'Native'}
              </span>
              {asset.domain && <span className="asset-selector__domain">{asset.domain}</span>}
              {verified ? (
                <span className="asset-selector__badge asset-selector__badge--verified" aria-label="Verified issuer">
                  ✓ Verified
                </span>
              ) : (
                ambiguousCodes.has(asset.code) && (
                  <span
                    className="asset-selector__badge asset-selector__badge--unverified"
                    aria-label="Unverified issuer — check the issuer address"
                  >
                    ⚠ Unverified
                  </span>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default AssetSelector;
