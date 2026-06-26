import * as StellarSDK from '@stellar/stellar-sdk';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';
import { getIssuer } from '../config/assets.js';
import logger, { withContext } from '../config/logger.js';
import prisma from '../db/client.js';
import { callWithCircuitBreaker } from './circuitBreaker.js';

/**
 * Retrieve aggregate fee-bump statistics from the database.
 * @returns {Promise<{total: number, totalFeeStroops: number, uniqueAccounts: number}>}
 */
export async function getFeeBumpStats() {
  const row = await prisma.feeBumpStat.findUnique({ where: { id: 'singleton' } });
  return {
    total: row?.total ?? 0,
    totalFeeStroops: Number(row?.totalFeeStroops ?? 0),
    uniqueAccounts: Array.isArray(row?.accounts) ? row.accounts.length : 0,
  };
}

async function incrementFeeBumpStats(sourcePublicKey, feeStroops) {
  try {
    // Upsert the singleton row, then atomically add the new account to the set
    await prisma.$transaction(async (tx) => {
      const existing = await tx.feeBumpStat.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          total: 1,
          totalFeeStroops: feeStroops,
          accounts: [sourcePublicKey],
        },
        update: {
          total: { increment: 1 },
          totalFeeStroops: { increment: feeStroops },
        },
      });
      // Add account to set if not already present
      const accounts = Array.isArray(existing.accounts) ? existing.accounts : [];
      if (!accounts.includes(sourcePublicKey)) {
        await tx.feeBumpStat.update({
          where: { id: 'singleton' },
          data: { accounts: [...accounts, sourcePublicKey] },
        });
      }
    });
  } catch (err) {
    logger.warn('stellar.feeBumpStats.persist.failed', { error: err.message });
  }
}

/**
 * Fee Bump Transaction
 * A fee bump allows a third-party sponsor (e.g. the platform account) to pay the
 * transaction fee on behalf of the source account. This is useful when users have
 * low XLM balances and cannot cover fees themselves — the inner transaction is
 * signed by the original sender, then wrapped so the sponsor covers the fee.
 * @see https://developers.stellar.org/docs/learn/fundamentals/transactions/fee-bumps
 *
 * Wrap an inner transaction with a FeeBumpTransaction so the platform account
 * pays the fee instead of the buyer. Fee multiplier is read from FEE_BUMP_MULTIPLIER
 * (default 10×).
 * @param {import('@stellar/stellar-sdk').Transaction} innerTx - Signed inner transaction to wrap
 * @param {string} feeAccountSecret - Secret key of the fee-sponsoring platform account
 * @returns {import('@stellar/stellar-sdk').FeeBumpTransaction} Signed fee-bump transaction ready to submit
 */
export function wrapWithFeeBump(innerTx, feeAccountSecret) {
  const feeKeypair = StellarSDK.Keypair.fromSecret(feeAccountSecret);
  const networkPassphrase = isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;

  const multiplier = parseInt(process.env.FEE_BUMP_MULTIPLIER ?? '10', 10);
  const feeBumpTx = StellarSDK.TransactionBuilder.buildFeeBumpTransaction(
    feeKeypair,
    StellarSDK.BASE_FEE * multiplier,
    innerTx,
    networkPassphrase,
  );
  feeBumpTx.sign(feeKeypair);
  return feeBumpTx;
}

let horizonServerUrl;
let horizonServer;

/**
 * Return a cached Stellar Horizon server instance, re-creating it if the URL has changed.
 * @returns {import('@stellar/stellar-sdk').Horizon.Server}
 */
export function getHorizonServer() {
  const { horizonUrl } = getConfig().stellar;
  if (!horizonServer || horizonUrl !== horizonServerUrl) {
    horizonServerUrl = horizonUrl;
    horizonServer = new StellarSDK.Horizon.Server(horizonUrl);
  }
  return horizonServer;
}

/** Timeout (ms) for Horizon calls. Reads HORIZON_TIMEOUT_MS env var, default 10 000. */
export function getHorizonTimeout() {
  return parseInt(process.env.HORIZON_TIMEOUT_MS ?? '10000', 10);
}

/**
 * Run a Horizon call with a timeout and circuit breaker.  Throws a 504-tagged
 * error on timeout, or a 503-tagged error when the circuit is open.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withHorizonTimeout(fn) {
  const ms = getHorizonTimeout();
  return callWithCircuitBreaker(() => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Horizon request timed out');
        err.isTimeout = true;
        reject(err);
      }, ms);
    });
    return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
  });
}

const HORIZON_RETRY_BACKOFFS = [500, 1000, 2000];

function isTransientHorizonError(err) {
  const status = err?.response?.status ?? err?.status;
  if (status === 400 || status === 404 || status === 409) return false;
  if (status === 429 || status === 503) return true;
  if (err.isTimeout) return true;
  const code = err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  return false;
}

/**
 * Run a Horizon call with timeout, circuit breaker, and exponential backoff retry.
 * Retries on 429, 503, and network timeouts (max 3 attempts: 500ms, 1s, 2s backoff).
 * Does NOT retry on 400, 404, or 409.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withHorizonRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= HORIZON_RETRY_BACKOFFS.length; attempt++) {
    try {
      return await withHorizonTimeout(fn);
    } catch (err) {
      lastErr = err;
      if (!isTransientHorizonError(err) || attempt === HORIZON_RETRY_BACKOFFS.length) throw err;
      const delay = HORIZON_RETRY_BACKOFFS[attempt];
      logger.warn('stellar.horizon.retry', { attempt: attempt + 1, delay, error: err.message });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Check whether the configured Stellar network is testnet.
 * @returns {boolean}
 */
export function isTestnet() {
  return getConfig().stellar.network === 'testnet';
}

/**
 * Fund a testnet account via Friendbot (testnet only).
 * @param {string} publicKey - Stellar public key of the account to fund
 * @returns {Promise<{funded: boolean, publicKey: string}>}
 * @throws {Error} If called on mainnet or if Friendbot returns a non-OK response
 */
export async function fundAccount(publicKey) {
  if (!isTestnet()) throw new Error('Only available on testnet');
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Friendbot funding failed: ${res.status} ${res.statusText}`);
  logger.debug('stellar.friendbotFunded', { publicKey });
  return { funded: true, publicKey };
}

/**
 * Generate a new Stellar keypair, fund it via Friendbot on testnet, and persist the user record.
 * @param {string|null} [correlationId] - Optional correlation ID for request tracing
 * @returns {Promise<{publicKey: string, secretKey: string}>} The newly created key pair
 * @throws {Error} If Friendbot funding fails
 * @example
 * const { publicKey, secretKey } = await createAccount('req-abc-123');
 */
export async function createAccount(correlationId = null) {
  const pair = StellarSDK.Keypair.random();
  const publicKey = pair.publicKey();
  withContext(logger, { action: 'createAccount', correlationId }).info('stellar.createAccount', {
    publicKey,
  });

  if (isTestnet()) {
    const friendbotRes = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    if (!friendbotRes.ok) {
      throw new Error(
        `Friendbot funding failed: ${friendbotRes.status} ${friendbotRes.statusText}`,
      );
    }
    logger.debug('stellar.friendbotFunded', { publicKey, correlationId });
    await eventMonitor.publishEvent(publicKey, {
      type: 'AccountFunded',
      data: { publicKey, correlationId },
      version: 1,
    });
  }

  await eventMonitor.publishEvent(publicKey, {
    type: 'AccountCreated',
    data: { publicKey, correlationId },
    version: 1,
  });

  await prisma.user
    .upsert({
      where: { publicKey },
      update: {},
      create: { publicKey },
    })
    .catch((err) => logger.warn('db.user.upsert.failed', { error: err.message, correlationId }));

  return {
    publicKey,
    secretKey: pair.secret(),
  };
}

/**
 * Fetch all asset balances for a Stellar account from Horizon.
 * @param {string} publicKey - Stellar public key of the account
 * @param {string|null} [correlationId] - Optional correlation ID for request tracing
 * @returns {Promise<{publicKey: string, balances: Array<{asset: string, balance: string}>}>}
 * @throws {Error} If the account does not exist on the network
 */
export async function getBalance(publicKey, correlationId = null) {
  logger.debug('stellar.getBalance', { publicKey, correlationId });
  const account = await withHorizonRetry(() => getHorizonServer().loadAccount(publicKey));
  const balances = account.balances.map((b) => ({
    asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`,
    balance: b.balance,
  }));

  logger.info('stellar.balanceFetched', { publicKey, balances, correlationId });

  return { publicKey, balances };
}

/**
 * Send a payment on the Stellar network. Automatically wraps in a fee-bump when the
 * sender's XLM balance is below FEE_BUMP_THRESHOLD_XLM and PLATFORM_FEE_ACCOUNT_SECRET is set.
 * Persists the transaction to the database and emits a PaymentSent event.
 * @param {string} sourceSecret - Secret key of the sending account
 * @param {string} destination - Stellar public key of the recipient
 * @param {string|number} amount - Amount to send (in asset units)
 * @param {string} [assetCode='XLM'] - Asset code (e.g. 'XLM', 'USDC')
 * @param {string|null} [memo] - Optional transaction memo value
 * @param {'text'|'id'|'hash'|'return'} [memoType='text'] - Stellar memo type
 * @param {string|null} [correlationId] - Optional correlation ID for request tracing
 * @returns {Promise<{hash: string, ledger: number, success: boolean, feeBump: boolean}>}
 * @throws {Error} If ASSET_ISSUER is missing for non-XLM assets, or if Horizon submission fails
 * @example
 * const result = await sendPayment(secret, 'GDEST...', '10', 'USDC', 'invoice-42');
 */
export async function sendPayment(
  sourceSecret,
  destination,
  amount,
  assetCode = 'XLM',
  memo = null,
  memoType = 'text',
  correlationId = null,
) {
  const { assetIssuer } = getConfig().stellar;
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.sendPayment.start', {
    source: sourcePublicKey,
    destination,
    amount,
    assetCode,
    memo,
    memoType,
    correlationId,
  });

  // Sequence Numbers
  // loadAccount fetches the current on-chain sequence number for the source account.
  // Every Stellar transaction must include a sequence number exactly one greater than
  // the account's last committed transaction. This guarantees transactions execute in
  // the intended order and prevents replay attacks (an old signed transaction cannot
  // be resubmitted once the sequence number has advanced).
  // @see https://developers.stellar.org/docs/learn/fundamentals/transactions/signals#sequence-number
  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  if (assetCode !== 'XLM' && !getIssuer(assetCode)) {
    throw new Error('ASSET_ISSUER is required for non-XLM payments');
  }

  const asset =
    assetCode === 'XLM'
      ? StellarSDK.Asset.native()
      : new StellarSDK.Asset(assetCode, getIssuer(assetCode));

  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
  }).addOperation(
    StellarSDK.Operation.payment({
      destination,
      asset,
      amount: amount.toString(),
    }),
  );

  if (memo) {
    let stellarMemo;
    switch (memoType) {
      case 'id':
        stellarMemo = StellarSDK.Memo.id(memo);
        break;
      case 'hash':
        stellarMemo = StellarSDK.Memo.hash(memo);
        break;
      case 'return':
        stellarMemo = StellarSDK.Memo.return(memo);
        break;
      case 'text':
      default:
        stellarMemo = StellarSDK.Memo.text(memo);
        break;
    }
    txBuilder.addMemo(stellarMemo);
  }

  const transaction = txBuilder.setTimeout(30).build();

  transaction.sign(sourceKeypair);

  // Fee bump: wrap if buyer XLM balance is below threshold and platform key is configured
  const platformFeeSecret = process.env.PLATFORM_FEE_ACCOUNT_SECRET;
  const feeBumpThreshold = parseFloat(process.env.FEE_BUMP_THRESHOLD_XLM ?? '2');
  let txToSubmit = transaction;
  let usedFeeBump = false;

  if (platformFeeSecret) {
    const xlmBalance = sourceAccount.balances.find((b) => b.asset_type === 'native');
    const xlmAmount = parseFloat(xlmBalance?.balance ?? '0');
    if (xlmAmount < feeBumpThreshold) {
      txToSubmit = wrapWithFeeBump(transaction, platformFeeSecret);
      usedFeeBump = true;
      logger.info('stellar.feeBump.applied', {
        source: sourcePublicKey,
        xlmBalance: xlmAmount,
        threshold: feeBumpThreshold,
        correlationId,
      });
      // Track stats for cost monitoring
      await incrementFeeBumpStats(
        sourcePublicKey,
        StellarSDK.BASE_FEE * parseInt(process.env.FEE_BUMP_MULTIPLIER ?? '10', 10),
      );
    }
  }

  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(txToSubmit));
  } catch (err) {
    logger.error('stellar.sendPayment.failed', {
      source: sourcePublicKey,
      destination,
      amount,
      assetCode,
      error: err.message,
      correlationId,
    });
    throw err;
  }

  logger.info('stellar.sendPayment.success', {
    source: sourcePublicKey,
    destination,
    amount,
    assetCode,
    hash: result.hash,
    ledger: result.ledger,
    feeBump: usedFeeBump,
    memo,
    memoType,
    correlationId,
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'PaymentSent',
    data: {
      destination,
      amount,
      hash: result.hash,
      feeBump: usedFeeBump,
      memo,
      memoType,
      correlationId,
    },
    version: 1,
  });

  // Persist transaction — ensure both users exist first
  await prisma
    .$transaction(async (tx) => {
      const [sender, recipient] = await Promise.all([
        tx.user.upsert({
          where: { publicKey: sourcePublicKey },
          update: {},
          create: { publicKey: sourcePublicKey },
        }),
        tx.user.upsert({
          where: { publicKey: destination },
          update: {},
          create: { publicKey: destination },
        }),
      ]);
      await tx.transaction.create({
        data: {
          hash: result.hash,
          assetCode: assetCode || 'XLM',
          amount,
          ledger: result.ledger ?? null,
          successful: result.successful,
          senderId: sender.id,
          recipientId: recipient.id,
          memo: memo ?? null,
          memoType: memo ? memoType || 'text' : null,
        },
      });
    })
    .catch((err) =>
      logger.warn('db.transaction.save.failed', { error: err.message, correlationId }),
    );

  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
    feeBump: usedFeeBump,
  };
}

/**
 * Trustlines
 * A trustline is an explicit opt-in by an account to hold, send, or receive a
 * specific non-native asset (e.g. USDC). Without a trustline, an account cannot
 * receive that asset. This protects users from receiving unwanted or spam tokens
 * without their consent. The Operation.changeTrust call below creates or updates
 * the trustline; setting limit to '0' removes it.
 * @see https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines
 *
 * Create a trustline for a non-XLM asset on an account. No-ops if the trustline already exists.
 * @param {string} sourceSecret - Secret key of the account adding the trustline
 * @param {string} assetCode - Asset code to trust (e.g. 'USDC')
 * @returns {Promise<{hash?: string, assetCode: string, issuer: string, alreadyExists?: boolean}>}
 * @throws {Error} If the asset issuer is unknown or Horizon submission fails
 */
export async function createTrustline(sourceSecret, assetCode) {
  const issuer = getIssuer(assetCode);
  if (!issuer) throw new Error(`Unknown asset or missing issuer for ${assetCode}`);

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.createTrustline', { publicKey: sourcePublicKey, assetCode });

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  const alreadyTrusted = sourceAccount.balances.some(
    (b) => b.asset_code === assetCode && b.asset_issuer === issuer,
  );
  if (alreadyTrusted) {
    logger.info('stellar.createTrustline.exists', { publicKey: sourcePublicKey, assetCode });
    return { alreadyExists: true, assetCode, issuer };
  }

  const asset = new StellarSDK.Asset(assetCode, issuer);

  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
  })
    .addOperation(StellarSDK.Operation.changeTrust({ asset }))
    .setTimeout(30)
    .build();

  transaction.sign(sourceKeypair);

  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    logger.error('stellar.createTrustline.failed', {
      publicKey: sourcePublicKey,
      assetCode,
      error: err.message,
    });
    throw err;
  }

  logger.info('stellar.createTrustline.success', {
    publicKey: sourcePublicKey,
    assetCode,
    hash: result.hash,
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'TrustlineCreated',
    data: { assetCode, issuer, hash: result.hash },
    version: 1,
  });

  return { hash: result.hash, assetCode, issuer };
}

/**
 * Remove an existing trustline from an account. The asset balance must be zero.
 * @param {string} sourceSecret - Secret key of the account removing the trustline
 * @param {string} assetCode - Asset code of the trustline to remove
 * @returns {Promise<{hash: string, assetCode: string, issuer: string}>}
 * @throws {Error} If the trustline doesn't exist, the balance is non-zero, or submission fails
 */
export async function removeTrustline(sourceSecret, assetCode) {
  const issuer = getIssuer(assetCode);
  if (!issuer) throw new Error(`Unknown asset or missing issuer for ${assetCode}`);

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.removeTrustline', { publicKey: sourcePublicKey, assetCode });

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  const balance = sourceAccount.balances.find(
    (b) => b.asset_code === assetCode && b.asset_issuer === issuer,
  );
  if (!balance) {
    throw new Error(`No trustline found for ${assetCode}`);
  }
  if (parseFloat(balance.balance) !== 0) {
    throw new Error(
      `Cannot remove trustline: balance is non-zero (${balance.balance} ${assetCode})`,
    );
  }

  const asset = new StellarSDK.Asset(assetCode, issuer);

  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
  })
    .addOperation(StellarSDK.Operation.changeTrust({ asset, limit: '0' }))
    .setTimeout(30)
    .build();

  transaction.sign(sourceKeypair);

  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    logger.error('stellar.removeTrustline.failed', {
      publicKey: sourcePublicKey,
      assetCode,
      error: err.message,
    });
    throw err;
  }

  logger.info('stellar.removeTrustline.success', {
    publicKey: sourcePublicKey,
    assetCode,
    hash: result.hash,
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'TrustlineRemoved',
    data: { assetCode, issuer, hash: result.hash },
    version: 1,
  });

  return { hash: result.hash, assetCode, issuer };
}

/**
 * Path Payments
 * A path payment lets the sender specify one asset to send while the recipient
 * receives a different asset. The Stellar network automatically routes the
 * conversion through on-chain order books or AMM liquidity pools to find the
 * best available exchange rate — no manual swap step required. This is ideal
 * for cross-currency remittances (e.g. send USDC, recipient receives EUR stablecoin).
 * Two variants exist: strict-send (fix the send amount, maximise what arrives)
 * and strict-receive (fix what the recipient gets, minimise what is sent).
 * Path payment logic for this platform lives in pathPayment.js (sendPathPayment,
 * findPaths, findPathsStrictReceive).
 * @see https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-list#path-payment-strict-send
 */

/**
 * Fetch paginated transaction history for an account from Stellar Horizon.
 * @param {string} publicKey - Stellar public key of the account
 * @param {object} [options={}]
 * @param {string} [options.cursor] - Paging token for cursor-based pagination
 * @param {number} [options.limit=10] - Maximum records per page (max 200)
 * @param {string} [options.type] - Filter by operation type (e.g. 'payment')
 * @param {string} [options.dateFrom] - ISO date string; exclude transactions before this date
 * @param {string} [options.dateTo] - ISO date string; exclude transactions after this date
 * @returns {Promise<{records: object[], nextCursor: string|null, hasMore: boolean}>}
 * @throws {Error} If the Horizon API call fails
 */
export async function getTransactions(
  publicKey,
  { cursor, limit = 10, type, dateFrom, dateTo } = {},
) {
  let builder = getHorizonServer().transactions().forAccount(publicKey).order('desc').limit(limit);
  if (cursor) builder = builder.cursor(cursor);

  const page = await withHorizonRetry(() => builder.call());

  let records = await Promise.all(
    page.records.map(async (tx) => {
      const ops = await tx.operations();
      const op = ops.records[0];
      const opType = op?.type ?? 'unknown';
      const amount = op?.amount ?? null;
      const asset =
        op?.asset_type === 'native' ? 'XLM' : op?.asset_code ? `${op.asset_code}` : null;
      const counterparty = opType === 'payment' ? (op.from === publicKey ? op.to : op.from) : null;
      const direction = opType === 'payment' ? (op.from === publicKey ? 'sent' : 'received') : null;

      return {
        id: tx.id,
        hash: tx.hash,
        type: opType,
        direction,
        amount,
        asset,
        counterparty,
        date: tx.created_at,
        fee: tx.fee_charged,
        successful: tx.successful,
        memo: tx.memo ?? null,
        cursor: tx.paging_token,
      };
    }),
  );

  if (type) records = records.filter((r) => r.type === type);
  if (dateFrom) records = records.filter((r) => new Date(r.date) >= new Date(dateFrom));
  if (dateTo) records = records.filter((r) => new Date(r.date) <= new Date(dateTo));

  return {
    records,
    nextCursor:
      page.records.length === limit ? page.records[page.records.length - 1].paging_token : null,
    hasMore: page.records.length === limit,
  };
}

/**
 * Retrieve current network fee statistics from Horizon with an XLM/USD conversion via the SDEX.
 * @returns {Promise<{feeStroops: number, feeXLM: string, feeUsd: string|null, xlmUsd: string|null, traditionalFeeUsd: number}>}
 * @throws {Error} If the Horizon feeStats call fails
 */
export async function getFeeStats() {
  const stats = await withHorizonRetry(() => getHorizonServer().feeStats());
  const feeStroops = parseInt(stats.fee_charged?.p50 ?? StellarSDK.BASE_FEE);
  const feeXLM = feeStroops / 1e7;

  // Fetch XLM/USD price via Stellar SDEX (XLM/USDC order book)
  let xlmUsd = null;
  try {
    const usdc = new StellarSDK.Asset('USDC', getIssuer('USDC'));
    const book = await withHorizonRetry(() =>
      getHorizonServer().orderbook(StellarSDK.Asset.native(), usdc).limit(1).call(),
    );
    const ask = parseFloat(book.asks?.[0]?.price);
    if (ask > 0) xlmUsd = ask;
  } catch (_) {
    /* non-critical: XLM/USD price lookup failure */
  }

  const feeUsd = xlmUsd ? feeXLM * xlmUsd : null;

  return {
    feeStroops,
    feeXLM: feeXLM.toFixed(7),
    feeUsd: feeUsd ? feeUsd.toFixed(6) : null,
    xlmUsd: xlmUsd ? xlmUsd.toFixed(4) : null,
    // Traditional wire transfer benchmark for comparison
    traditionalFeeUsd: 25,
  };
}

/**
 * Look up the best ask price between two assets using the Stellar SDEX order book.
 * @param {string} from - Source asset code (e.g. 'XLM')
 * @param {string} to - Destination asset code (e.g. 'USDC')
 * @returns {Promise<number|null>} Best ask price, or null if unavailable
 * @example
 * const rate = await getExchangeRate('XLM', 'USDC'); // e.g. 0.12
 */
export async function getExchangeRate(from, to) {
  if (from === to) return 1.0;
  try {
    const fromAsset =
      from === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(from, getIssuer(from));
    const toAsset =
      to === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(to, getIssuer(to));
    const orderbook = await withHorizonRetry(() =>
      getHorizonServer().orderbook(fromAsset, toAsset).call(),
    );
    const bestAsk = orderbook.asks?.[0]?.price;
    return bestAsk ? parseFloat(bestAsk) : null;
  } catch (err) {
    logger.warn('stellar.getExchangeRate.failed', { from, to, error: err.message });
    return null;
  }
}

/**
 * Check the configured Horizon server's liveness and return network metadata.
 * @returns {Promise<{network: string, horizonUrl: string, online: boolean, horizonVersion?: string, networkPassphrase?: string, currentProtocolVersion?: number}>}
 */
export async function getNetworkStatus() {
  const { horizonUrl } = getConfig().stellar;
  try {
    const root = await withHorizonRetry(() => getHorizonServer().root());
    const status = {
      network: isTestnet() ? 'testnet' : 'mainnet',
      horizonUrl,
      online: true,
      horizonVersion: root.horizon_version,
      networkPassphrase: root.network_passphrase,
      currentProtocolVersion: root.current_protocol_version,
    };
    logger.debug('stellar.networkStatus', status);
    return status;
  } catch (err) {
    logger.warn('stellar.networkStatus.offline', { error: err.message });
    return {
      network: isTestnet() ? 'testnet' : 'mainnet',
      horizonUrl,
      online: false,
    };
  }
}
/**
 * List all non-native trustlines held by an account.
 * @param {string} publicKey - Stellar public key of the account
 * @returns {Promise<Array<{assetCode: string, issuer: string, balance: string, limit: string, authorized: boolean}>>}
 * @throws {Error} If the account does not exist on the network
 */
export async function getTrustlines(publicKey) {
  logger.debug('stellar.getTrustlines', { publicKey });
  const account = await withHorizonRetry(() => getHorizonServer().loadAccount(publicKey));
  return account.balances
    .filter((b) => b.asset_type !== 'native')
    .map((b) => ({
      assetCode: b.asset_code,
      issuer: b.asset_issuer,
      balance: b.balance,
      limit: b.limit,
      authorized: b.is_authorized === true,
    }));
}

/**
 * Merge a Stellar account into a destination account, transferring all remaining XLM and closing the source.
 * All trustlines and non-XLM balances must be removed before merging.
 * @param {string} sourceSecret - Secret key of the account to merge (will be closed)
 * @param {string} destination - Stellar public key of the receiving account
 * @returns {Promise<{hash: string, ledger: number, success: boolean}>}
 * @throws {Error} If the account has non-zero non-XLM balances or Horizon submission fails
 */
export async function mergeAccount(sourceSecret, destination) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.mergeAccount.start', { source: sourcePublicKey, destination });

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
  })
    .addOperation(StellarSDK.Operation.accountMerge({ destination }))
    .setTimeout(30)
    .build();

  transaction.sign(sourceKeypair);

  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    logger.error('stellar.mergeAccount.failed', {
      source: sourcePublicKey,
      destination,
      error: err.message,
    });
    throw err;
  }

  logger.info('stellar.mergeAccount.success', {
    source: sourcePublicKey,
    destination,
    hash: result.hash,
    ledger: result.ledger,
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'AccountMerged',
    data: { destination, hash: result.hash },
    version: 1,
  });

  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
  };
}
