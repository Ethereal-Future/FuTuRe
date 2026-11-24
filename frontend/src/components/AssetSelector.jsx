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
/**
 * AssetSelector — searchable list of Stellar assets (#1700).
 *
 * Asset codes are not unique on Stellar: anyone can issue a token called
 * "USDC". To prevent users from picking a look-alike/scam token, results:
 *   - always show the (truncated) issuer public key next to the code,
 *   - mark issuers from the verified list with a badge, and sort them first,
 *   - flag codes that appear with more than one issuer as ambiguous,
 *   - can be searched by asset code, home domain, or issuer public key
 *     (full 56-char key or any fragment of it).
 */
import { useMemo, useState, useId } from 'react';

const ISSUER_KEY_RE = /^G[A-Z2-7]{55}$/;

/** Truncate a Stellar public key for display, e.g. GABC…WXYZ. */
export function truncateIssuer(issuer, head = 4, tail = 4) {
  if (!issuer || typeof issuer !== 'string') return '';
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
export function isNativeAsset(asset) {
  return !asset?.issuer && (asset?.code ?? '').toUpperCase() === 'XLM';
}

export function assetId(asset) {
  return isNativeAsset(asset) ? 'native' : `${asset.code}:${asset.issuer}`;
}

/**
 * An asset is verified if it carries `verified: true` or its issuer is in
 * `verifiedIssuers` (a Set/array of issuer keys, or a map of code → issuer[]).
 */
export function isVerifiedAsset(asset, verifiedIssuers) {
  if (isNativeAsset(asset)) return true;
  if (asset?.verified === true) return true;
  if (!verifiedIssuers || !asset?.issuer) return false;
  if (verifiedIssuers instanceof Set) return verifiedIssuers.has(asset.issuer);
  if (Array.isArray(verifiedIssuers)) return verifiedIssuers.includes(asset.issuer);
  const forCode = verifiedIssuers[asset.code];
  return Array.isArray(forCode) && forCode.includes(asset.issuer);
}

/**
 * Filter assets by a query that may match the asset code, home domain, or
 * issuer key. Verified assets sort first, then exact code matches.
 */
export function filterAssets(assets, query, verifiedIssuers) {
  const q = (query ?? '').trim();
  const qUpper = q.toUpperCase();
  const isIssuerQuery = ISSUER_KEY_RE.test(qUpper);

  const matches = (assets ?? []).filter((a) => {
    if (!q) return true;
    const code = (a.code ?? '').toUpperCase();
    const issuer = (a.issuer ?? '').toUpperCase();
    const domain = (a.domain ?? '').toLowerCase();
    if (isIssuerQuery) return issuer === qUpper;
    return (
      code.includes(qUpper) ||
      (qUpper.length >= 3 && issuer.includes(qUpper)) ||
      (domain && domain.includes(q.toLowerCase()))
    );
  });

  return matches
    .map((a) => ({ asset: a, verified: isVerifiedAsset(a, verifiedIssuers) }))
    .sort((x, y) => {
      if (x.verified !== y.verified) return x.verified ? -1 : 1;
      const xExact = (x.asset.code ?? '').toUpperCase() === qUpper;
      const yExact = (y.asset.code ?? '').toUpperCase() === qUpper;
      if (xExact !== yExact) return xExact ? -1 : 1;
      return (x.asset.code ?? '').localeCompare(y.asset.code ?? '');
    });
}

export function AssetSelector({
  assets = [],
  value,
  onChange,
  verifiedIssuers = VERIFIED_ISSUERS,
  label = 'Asset',
  placeholder = 'Search by code, issuer key or domain',
  verifiedIssuers,
  value,
  onSelect,
  label = 'Search assets',
  placeholder = 'Search by code, domain, or issuer key (G…)',
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
  // Codes issued by more than one account in the full list are ambiguous.
  const ambiguousCodes = useMemo(() => {
    const issuersByCode = new Map();
    for (const a of assets) {
      if (isNativeAsset(a)) continue;
      const code = (a.code ?? '').toUpperCase();
      if (!issuersByCode.has(code)) issuersByCode.set(code, new Set());
      issuersByCode.get(code).add(a.issuer);
    }
    return new Set([...issuersByCode].filter(([, s]) => s.size > 1).map(([c]) => c));
  }, [assets]);

  const selectedId = value ? assetId(value) : null;

  return (
    <div className="asset-selector">
      <label htmlFor={inputId} className="asset-selector__label">{label}</label>
      <input
        id={inputId}
        type="search"
        className="asset-selector__input"
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
      />
      <ul id={listId} role="listbox" aria-label={`${label} results`} className="asset-selector__list">
      <ul id={listId} className="asset-selector__results" role="listbox" aria-label="Asset results">
        {results.length === 0 && (
          <li className="asset-selector__empty" role="option" aria-disabled="true" aria-selected="false">
            No matching assets
          </li>
        )}
        {results.map((asset) => {
          const id = assetId(asset);
          const verified = isVerifiedAsset(asset, verifiedIssuers);
          const selected = value === id;
        {results.map(({ asset, verified }) => {
          const id = assetId(asset);
          const native = isNativeAsset(asset);
          const ambiguous = !native && ambiguousCodes.has((asset.code ?? '').toUpperCase());
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
              aria-selected={id === selectedId}
              data-testid={`asset-option-${id}`}
              className={`asset-selector__option${verified ? ' is-verified' : ' is-unverified'}`}
            >
              <button
                type="button"
                className="asset-selector__btn"
                onClick={() => onSelect?.(asset)}
                title={native ? 'Stellar Lumens (native)' : `${asset.code} issued by ${asset.issuer}`}
                aria-label={
                  native
                    ? 'XLM, native asset'
                    : `${asset.code} issued by ${asset.issuer}${verified ? ', verified issuer' : ', unverified issuer'}`
                }
              >
                <span className="asset-selector__code">{asset.code}</span>
                {!native && (
                  <span className="asset-selector__issuer" data-testid="asset-issuer">
                    {asset.domain ? `${asset.domain} · ` : ''}{truncateIssuer(asset.issuer)}
                  </span>
                )}
                {verified ? (
                  <span className="asset-selector__badge asset-selector__badge--verified" data-testid="verified-badge">
                    ✓ Verified
                  </span>
                ) : (
                  <span className="asset-selector__badge asset-selector__badge--unverified" data-testid="unverified-badge">
                    Unverified
                  </span>
                )}
                {ambiguous && !verified && (
                  <span className="asset-selector__warning" role="note">
                    ⚠ Same code as another asset — check the issuer
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default AssetSelector;
