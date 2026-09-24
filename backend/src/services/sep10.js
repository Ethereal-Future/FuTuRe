import * as StellarSDK from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { getConfig } from '../config/env.js';
import { RedisBackend } from '../cache/redis.js';
import { assertDnsPin, validatePublicDomain, validatePublicHttpsUrl } from '../utils/ssrfValidator.js';

const FETCH_TIMEOUT_MS = 10000;
const CLOCK_SKEW_SECONDS = 30;
const inMemoryTokenCache = new Map();
const redisCache = new RedisBackend(process.env.REDIS_URL ?? null);
let redisInitPromise;

function parseTomlField(tomlText, key) {
  const match = tomlText.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : null;
}

async function getRedisCache() {
  if (!redisCache.client) return null;
  if (!redisInitPromise) {
    redisInitPromise = redisCache.connect().catch(() => null);
  }
  await redisInitPromise;
  return redisCache;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutErr = new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const err = new Error(`Request to ${url} failed: ${error.message}`);
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getJwtExpEpochSeconds(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return Number.isFinite(parsed?.exp) ? parsed.exp : null;
  } catch {
    return null;
  }
}

function validateChallengeTransaction(challengeXdr, signingKey, accountPublicKey, homeDomain) {
  const networkPassphrase =
    getConfig().stellar.network === 'testnet'
      ? StellarSDK.Networks.TESTNET
      : StellarSDK.Networks.PUBLIC;

  const tx = StellarSDK.TransactionBuilder.fromXDR(challengeXdr, networkPassphrase);
  if (tx.source !== signingKey) {
    throw new Error('SEP-10 challenge source account does not match SIGNING_KEY');
  }

  if (String(tx.sequence) !== '0') {
    throw new Error('SEP-10 challenge transaction sequence must be 0');
  }

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!maxTime || now > maxTime + CLOCK_SKEW_SECONDS) {
    throw new Error('SEP-10 challenge transaction has expired timebounds');
  }

  const hasHomeDomainOp = tx.operations.some(
    (op) => op.type === 'manageData' && op.name === `${homeDomain} auth`,
  );
  if (!hasHomeDomainOp) {
    throw new Error('SEP-10 challenge transaction missing home-domain manage_data operation');
  }

  const hasClientAccountOp = tx.operations.some(
    (op) => op.source === accountPublicKey || op.source === undefined,
  );
  if (!hasClientAccountOp) {
    throw new Error('SEP-10 challenge transaction is not scoped to the client account');
  }

  return tx;
}

function getCacheKey(homeDomain, accountPublicKey) {
  return `sep10:jwt:${homeDomain}:${accountPublicKey}`;
}

async function getCachedToken(homeDomain, accountPublicKey) {
  const key = getCacheKey(homeDomain, accountPublicKey);
  const inMemory = inMemoryTokenCache.get(key);
  const now = Math.floor(Date.now() / 1000);
  if (inMemory && inMemory.exp > now + CLOCK_SKEW_SECONDS) {
    return inMemory.token;
  }

  const redis = await getRedisCache();
  const cached = redis ? await redis.get(key) : null;
  if (cached?.token && cached?.exp > now + CLOCK_SKEW_SECONDS) {
    inMemoryTokenCache.set(key, cached);
    return cached.token;
  }
  return null;
}

async function setCachedToken(homeDomain, accountPublicKey, token, exp) {
  const key = getCacheKey(homeDomain, accountPublicKey);
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(exp - now - CLOCK_SKEW_SECONDS, 1);
  const payload = { token, exp };
  inMemoryTokenCache.set(key, payload);
  const redis = await getRedisCache();
  if (redis) {
    await redis.set(key, payload, ttl);
  }
}

async function loadAnchorSep10Config(homeDomain, dnsPin) {
  const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
  await assertDnsPin(dnsPin);
  const response = await fetchWithTimeout(tomlUrl);
  if (!response.ok) {
    const err = new Error(`${homeDomain} returned ${response.status} fetching stellar.toml`);
    err.status = 502;
    throw err;
  }
  const tomlText = await response.text();
  const webAuthEndpoint = parseTomlField(tomlText, 'WEB_AUTH_ENDPOINT');
  const signingKey = parseTomlField(tomlText, 'SIGNING_KEY');
  if (!webAuthEndpoint || !signingKey) {
    const err = new Error(`${homeDomain} does not advertise WEB_AUTH_ENDPOINT and SIGNING_KEY`);
    err.status = 502;
    throw err;
  }
  return { webAuthEndpoint, signingKey };
}

function getSep10SigningSecret() {
  const secret =
    process.env.SEP10_SENDER_SECRET ||
    process.env.SEP10_SIGNING_SECRET ||
    process.env.PLATFORM_FEE_ACCOUNT_SECRET;
  if (!secret) {
    const err = new Error('SEP-10 signing secret is not configured');
    err.status = 500;
    throw err;
  }
  return secret;
}

export async function authenticateWithAnchor(anchorUrl) {
  const { parsed: anchorParsed, dnsPin } = await validatePublicHttpsUrl(anchorUrl);
  const homeDomain = anchorParsed.hostname;
  const { webAuthEndpoint, signingKey } = await loadAnchorSep10Config(homeDomain, dnsPin);
  const { normalizedUrl: validatedWebAuthUrl, dnsPin: authDnsPin } =
    await validatePublicHttpsUrl(webAuthEndpoint, { allowPath: true, allowQuery: true });

  const signerSecret = getSep10SigningSecret();
  const signerKeypair = StellarSDK.Keypair.fromSecret(signerSecret);
  const accountPublicKey = signerKeypair.publicKey();
  const cachedToken = await getCachedToken(homeDomain, accountPublicKey);
  if (cachedToken) {
    return cachedToken;
  }

  await assertDnsPin(authDnsPin);
  const challengeResponse = await fetchWithTimeout(
    `${validatedWebAuthUrl}${validatedWebAuthUrl.includes('?') ? '&' : '?'}account=${encodeURIComponent(accountPublicKey)}`,
  );
  if (!challengeResponse.ok) {
    const err = new Error(`WEB_AUTH_ENDPOINT returned ${challengeResponse.status} requesting challenge`);
    err.status = 502;
    throw err;
  }
  const challengeBody = await challengeResponse.json();
  const challengeXdr = challengeBody?.transaction;
  if (!challengeXdr) {
    const err = new Error('WEB_AUTH_ENDPOINT challenge response is missing transaction XDR');
    err.status = 502;
    throw err;
  }

  const challengeTx = validateChallengeTransaction(
    challengeXdr,
    signingKey,
    accountPublicKey,
    homeDomain,
  );
  challengeTx.sign(signerKeypair);

  await assertDnsPin(authDnsPin);
  const tokenResponse = await fetchWithTimeout(validatedWebAuthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: challengeTx.toXDR() }),
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody?.token) {
    const err = new Error(tokenBody?.error || `WEB_AUTH_ENDPOINT returned ${tokenResponse.status} exchanging token`);
    err.status = 502;
    throw err;
  }

  const exp = getJwtExpEpochSeconds(tokenBody.token);
  if (exp) {
    await setCachedToken(homeDomain, accountPublicKey, tokenBody.token, exp);
  }
  logger.info('sep10.authenticate.success', {
    anchorDomain: homeDomain,
    account: accountPublicKey,
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
  });
  return tokenBody.token;
}

export async function validateSep31AnchorDomain(domain) {
  return validatePublicDomain(domain);
}
