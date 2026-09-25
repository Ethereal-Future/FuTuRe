/**
 * SEP-0031 ("Cross-Border Payments API") sending-anchor client.
 *
 * Lets this platform hand off a payment to a receiving anchor in the
 * recipient's country for local payout, discovered via the receiving
 * anchor's stellar.toml (SEP-1) DIRECT_PAYMENT_SERVER field — the same
 * discovery mechanism this platform's own stellar.toml advertises via
 * buildStellarToml() in services/federation.js.
 *
 * Scope: this module implements the sending-anchor role only (discovery,
 * transaction creation, status polling). It does not implement SEP-0012
 * (KYC) customer exchange — anchors that require complex KYC beyond what
 * `fields`/`extra_fields` on POST /transactions can carry are out of scope
 * for this first pass and are expected to be handled as a follow-up. See
 * issue #955.
 */

import logger from '../config/logger.js';
import prisma from '../db/client.js';
import { authenticateWithAnchor, validateSep31AnchorDomain } from './sep10.js';
import { assertDnsPin, validatePublicHttpsUrl } from '../utils/ssrfValidator.js';

const FETCH_TIMEOUT_MS = 10000;
const TERMINAL_SEP31_STATUSES = new Set(['completed', 'error', 'expired', 'rejected']);
const POLL_PHASES = {
  initialMs: 15 * 1000,
  mediumMs: 2 * 60 * 1000,
  slowMs: 60 * 60 * 1000,
};

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
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

/**
 * Minimal TOML scalar-string field extractor — sufficient for the top-level
 * quoted-string fields (DIRECT_PAYMENT_SERVER, SIGNING_KEY, ...) a SEP-1
 * stellar.toml defines. Not a general-purpose TOML parser.
 * @param {string} tomlText
 * @param {string} key
 * @returns {string|null}
 */
function parseTomlField(tomlText, key) {
  const match = tomlText.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : null;
}

function normalizeDomain(domain) {
  return String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

function isTerminalStatus(status) {
  return TERMINAL_SEP31_STATUSES.has(String(status || '').toLowerCase());
}

function parseSeconds(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function getAnchorRecommendedDelayMs(transaction, nowMs) {
  const retryAfterSeconds = parseSeconds(transaction?.retry_after);
  if (retryAfterSeconds) return retryAfterSeconds * 1000;

  const etaSeconds = parseSeconds(transaction?.eta);
  if (etaSeconds) return etaSeconds * 1000;

  const etaDate = transaction?.eta ? Date.parse(transaction.eta) : Number.NaN;
  if (Number.isFinite(etaDate) && etaDate > nowMs) {
    return etaDate - nowMs;
  }
  return null;
}

/**
 * Determine next polling timestamp based on transaction age + anchor guidance.
 * @param {{createdAt: Date|string, pollCount?: number}} row
 * @param {object} transaction
 * @param {Date} [now]
 * @returns {Date}
 */
export function calculateNextSep31PollAt(row, transaction, now = new Date()) {
  const nowMs = now.getTime();
  const createdMs = new Date(row.createdAt).getTime();
  const ageMs = Math.max(0, nowMs - createdMs);

  let baseDelayMs;
  if (ageMs < 2 * 60 * 1000) baseDelayMs = POLL_PHASES.initialMs;
  else if (ageMs < (2 * 60 * 1000) + (60 * 60 * 1000)) baseDelayMs = POLL_PHASES.mediumMs;
  else baseDelayMs = POLL_PHASES.slowMs;

  const anchorDelayMs = getAnchorRecommendedDelayMs(transaction, nowMs);
  const delayMs = anchorDelayMs ? Math.max(baseDelayMs, anchorDelayMs) : baseDelayMs;
  return new Date(nowMs + delayMs);
}

/**
 * Discover a receiving anchor's SEP-0031 endpoint from its stellar.toml.
 * @param {string} domain - The receiving anchor's home domain (no scheme).
 * @returns {Promise<{ domain: string, directPaymentServer: string }>}
 */
export async function discoverReceivingAnchor(domain) {
  const { hostname: cleanDomain, dnsPin } = await validateSep31AnchorDomain(domain);

  const tomlUrl = `https://${cleanDomain}/.well-known/stellar.toml`;
  await assertDnsPin(dnsPin);
  const response = await fetchWithTimeout(tomlUrl);
  if (!response.ok) {
    const err = new Error(`${cleanDomain} returned ${response.status} fetching stellar.toml`);
    err.status = 502;
    throw err;
  }

  const tomlText = await response.text();
  const directPaymentServer = parseTomlField(tomlText, 'DIRECT_PAYMENT_SERVER');
  if (!directPaymentServer) {
    const err = new Error(`${cleanDomain} does not advertise a DIRECT_PAYMENT_SERVER (no SEP-0031 support)`);
    err.status = 404;
    throw err;
  }

  logger.info('sep31.discoverReceivingAnchor', { domain: cleanDomain, directPaymentServer });
  return { domain: cleanDomain, directPaymentServer };
}

/**
 * Fetch a SEP-0031 receiving anchor's supported assets and required fields
 * via GET /info.
 * @param {string} anchorUrl - The anchor's DIRECT_PAYMENT_SERVER base URL.
 * @returns {Promise<object>} The anchor's /info response body.
 */
export async function getAnchorInfo(anchorUrl) {
  const cleanAnchorUrl = trimTrailingSlash(anchorUrl);
  const { dnsPin } = await validatePublicHttpsUrl(cleanAnchorUrl, { allowPath: true, allowQuery: true });
  const url = `${cleanAnchorUrl}/info`;
  await assertDnsPin(dnsPin);
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    const err = new Error(`Anchor ${anchorUrl} returned ${response.status} from GET /info`);
    err.status = 502;
    throw err;
  }
  return response.json();
}

/**
 * Create a cross-border payment transaction against a receiving anchor via
 * POST /transactions, and persist the returned transaction id for status
 * tracking.
 * @param {string} anchorUrl - The anchor's DIRECT_PAYMENT_SERVER base URL.
 * @param {object} params - SEP-0031 transaction params (amount, asset_code, sender_id, receiver_id, fields, ...).
 * @param {object} [options]
 * @param {string} [options.authToken] - Bearer token if the anchor requires SEP-10 auth.
 * @returns {Promise<object>} The anchor's response, merged with the local tracking record id.
 */
export async function createCrossBorderTransaction(anchorUrl, params, { authToken } = {}) {
  if (!params || typeof params.amount === 'undefined' || !params.asset_code) {
    const err = new Error('amount and asset_code are required');
    err.status = 400;
    throw err;
  }

  const cleanAnchorUrl = trimTrailingSlash(anchorUrl);
  const { dnsPin } = await validatePublicHttpsUrl(cleanAnchorUrl, { allowPath: true, allowQuery: true });
  const resolvedAuthToken = authToken || (await authenticateWithAnchor(cleanAnchorUrl));
  await assertDnsPin(dnsPin);
  const response = await fetchWithTimeout(`${cleanAnchorUrl}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedAuthToken ? { Authorization: `Bearer ${resolvedAuthToken}` } : {}),
    },
    body: JSON.stringify(params),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    const err = new Error(body.error || `Anchor ${cleanAnchorUrl} rejected the transaction request (${response.status})`);
    err.status = response.status >= 400 ? response.status : 502;
    throw err;
  }

  let record = null;
  try {
    record = await prisma.sep31Transaction.create({
      data: {
        anchorUrl: cleanAnchorUrl,
        externalId: body.id,
        status: 'pending_sender',
        pollCount: 0,
        pollingActive: true,
        terminalState: false,
        nextPollAt: new Date(),
        amount: String(params.amount),
        assetCode: params.asset_code,
        senderPublicKey: params.sender_id ?? null,
        receiverPublicKey: params.receiver_id ?? null,
        stellarAccountId: body.stellar_account_id ?? null,
        stellarMemo: body.stellar_memo ?? null,
        stellarMemoType: body.stellar_memo_type ?? null,
      },
    });
  } catch (error) {
    // Non-fatal: the anchor has already accepted the transaction. Losing the
    // local tracking row means status polling below won't update it, but the
    // caller still gets the anchor's response (including the id) to retry
    // persistence or poll directly.
    logger.warn('sep31.createCrossBorderTransaction.persist.failed', {
      anchorUrl: cleanAnchorUrl,
      externalId: body.id,
      error: error.message,
    });
  }

  logger.info('sep31.createCrossBorderTransaction', { anchorUrl: cleanAnchorUrl, id: body.id });
  return { ...body, localRecordId: record?.id ?? null };
}

/**
 * Poll a SEP-0031 transaction's status via GET /transactions/:id, and
 * persist the latest status against the local tracking row.
 * @param {string} anchorUrl - The anchor's DIRECT_PAYMENT_SERVER base URL.
 * @param {string} id - The anchor-assigned transaction id.
 * @param {object} [options]
 * @param {string} [options.authToken] - Bearer token if the anchor requires SEP-10 auth.
 * @returns {Promise<object>} The anchor's transaction status body.
 */
export async function getTransactionStatus(anchorUrl, id, { authToken } = {}) {
  if (!id) {
    const err = new Error('id is required');
    err.status = 400;
    throw err;
  }

  const cleanAnchorUrl = trimTrailingSlash(anchorUrl);
  const { dnsPin } = await validatePublicHttpsUrl(cleanAnchorUrl, { allowPath: true, allowQuery: true });
  const resolvedAuthToken = authToken || (await authenticateWithAnchor(cleanAnchorUrl));
  await assertDnsPin(dnsPin);
  const response = await fetchWithTimeout(`${cleanAnchorUrl}/transactions/${encodeURIComponent(id)}`, {
    headers: resolvedAuthToken ? { Authorization: `Bearer ${resolvedAuthToken}` } : {},
  });

  if (!response.ok) {
    const err = new Error(`Anchor ${cleanAnchorUrl} returned ${response.status} for transaction ${id}`);
    err.status = 502;
    throw err;
  }

  const body = await response.json();
  const transaction = body.transaction ?? body;
  const now = new Date();
  const terminalState = isTerminalStatus(transaction.status);

  try {
    const localRows = await prisma.sep31Transaction.findMany({
      where: { anchorUrl: cleanAnchorUrl, externalId: id },
      select: { id: true, createdAt: true },
    });
    if (localRows.length > 0) {
      await Promise.all(
        localRows.map((row) =>
          prisma.sep31Transaction.update({
            where: { id: row.id },
            data: {
              status: transaction.status ?? 'unknown',
              pollCount: { increment: 1 },
              pollingActive: !terminalState,
              terminalState,
              nextPollAt: terminalState ? null : calculateNextSep31PollAt(row, transaction, now),
            },
          }),
        ),
      );
    } else {
      await prisma.sep31Transaction.updateMany({
        where: { anchorUrl: cleanAnchorUrl, externalId: id },
        data: {
          status: transaction.status ?? 'unknown',
          pollCount: { increment: 1 },
          pollingActive: !terminalState,
          terminalState,
          nextPollAt: terminalState ? null : calculateNextSep31PollAt({ createdAt: now }, transaction, now),
        },
      });
    }
  } catch (error) {
    logger.warn('sep31.getTransactionStatus.persist.failed', {
      anchorUrl: cleanAnchorUrl,
      externalId: id,
      error: error.message,
    });
  }

  logger.info('sep31.getTransactionStatus', { anchorUrl: cleanAnchorUrl, id, status: transaction.status });
  return transaction;
}

/**
 * Poll due SEP-31 transactions and reschedule according to adaptive backoff.
 * @returns {Promise<number>} number of rows processed
 */
export async function processSep31StatusPolls() {
  const now = new Date();
  const due = await prisma.sep31Transaction.findMany({
    where: {
      pollingActive: true,
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    orderBy: { nextPollAt: 'asc' },
    take: 50,
  });

  for (const row of due) {
    try {
      await getTransactionStatus(row.anchorUrl, row.externalId);
    } catch (error) {
      if (error?.status === 502 && error?.message?.includes(' 429 ')) {
        await prisma.sep31Transaction.update({
          where: { id: row.id },
          data: {
            nextPollAt: new Date(Date.now() + 5 * 60 * 1000),
            pollCount: { increment: 1 },
          },
        });
      } else {
        logger.warn('sep31.processStatusPoll.failed', {
          anchorUrl: row.anchorUrl,
          externalId: row.externalId,
          error: error.message,
        });
      }
    }
  }

  return due.length;
}
