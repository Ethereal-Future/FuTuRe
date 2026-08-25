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

const FETCH_TIMEOUT_MS = 10000;

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

/**
 * Discover a receiving anchor's SEP-0031 endpoint from its stellar.toml.
 * @param {string} domain - The receiving anchor's home domain (no scheme).
 * @returns {Promise<{ domain: string, directPaymentServer: string }>}
 */
export async function discoverReceivingAnchor(domain) {
  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain) {
    const err = new Error('domain is required');
    err.status = 400;
    throw err;
  }

  const tomlUrl = `https://${cleanDomain}/.well-known/stellar.toml`;
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
  const url = `${trimTrailingSlash(anchorUrl)}/info`;
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
  const response = await fetchWithTimeout(`${cleanAnchorUrl}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
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
  const response = await fetchWithTimeout(`${cleanAnchorUrl}/transactions/${encodeURIComponent(id)}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });

  if (!response.ok) {
    const err = new Error(`Anchor ${cleanAnchorUrl} returned ${response.status} for transaction ${id}`);
    err.status = 502;
    throw err;
  }

  const body = await response.json();
  const transaction = body.transaction ?? body;

  try {
    await prisma.sep31Transaction.updateMany({
      where: { anchorUrl: cleanAnchorUrl, externalId: id },
      data: { status: transaction.status ?? 'unknown' },
    });
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
