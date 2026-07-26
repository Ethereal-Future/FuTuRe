/**
 * Stellar service — typed TypeScript pilot migration (issue #771).
 *
 * This file is the authoritative implementation. stellar.js is retained
 * during the incremental migration period so that callers that import the
 * .js extension explicitly continue to work. Once all callers are updated,
 * stellar.js will be removed.
 */

import * as StellarSDK from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';
import { getIssuer } from '../config/assets.js';
import logger, { withContext } from '../config/logger.js';
import prisma from '../db/client.js';
import { callWithCircuitBreaker } from './circuitBreaker.js';
import { getCachedBalance, invalidateBalanceCache } from '../cache/balanceCache.js';
import { recordHorizonCall } from '../monitoring/horizonAlerter.js';
import { withSpan } from '../config/otel.js';

// ---------------------------------------------------------------------------
// Shared type definitions
// ---------------------------------------------------------------------------

export interface AssetBalance {
  asset: string;
  balance: string;
}

export interface PaymentResult {
  hash: string;
  ledger: number;
  success: boolean;
  feeBump: boolean;
}

export interface TrustlineResult {
  hash?: string;
  assetCode: string;
  issuer: string;
  alreadyExists?: boolean;
}

export interface TransactionRecord {
  id: string;
  hash: string;
  type: string;
  direction: 'sent' | 'received' | null;
  amount: string | null;
  asset: string | null;
  counterparty: string | null;
  date: string;
  fee: string;
  successful: boolean;
  memo: string | null;
  cursor: string;
  ledger: number;
  envelopeXdr: string;
}

export interface TransactionPage {
  records: TransactionRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FeeStats {
  feeStroops: number;
  feeXLM: string;
  feeUsd: string | null;
  xlmUsd: string | null;
  traditionalFeeUsd: number;
  baseFeeStroops: number;
  baseFeeXLM: string;
  surgeMultiplier: string;
}

export interface NetworkStatus {
  network: string;
  horizonUrl: string;
  online: boolean;
  horizonVersion?: string;
  networkPassphrase?: string;
  currentProtocolVersion?: number;
}

export interface LatencyMeasurement {
  latencyMs: number | null;
  horizonUrl: string;
  online: boolean;
  measuredAt: string;
}

export interface FeeBumpStats {
  total: number;
  totalFeeStroops: number;
  uniqueAccounts: number;
}

export interface TrustlineInfo {
  assetCode: string;
  issuer: string;
  balance: string;
  limit: string;
  authorized: boolean;
}

export interface MergeAccountResult {
  hash: string;
  ledger: number;
  success: boolean;
}

export interface UnsignedXdrResult {
  xdr: string;
}

export type MemoType = 'text' | 'id' | 'hash' | 'return';

// ---------------------------------------------------------------------------
// Fee-bump stats helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve aggregate fee-bump statistics from the database.
 */
export async function getFeeBumpStats(): Promise<FeeBumpStats> {
  const row = await prisma.feeBumpStat.findUnique({ where: { id: 'singleton' } });
  return {
    total: row?.total ?? 0,
    totalFeeStroops: Number(row?.totalFeeStroops ?? 0),
    uniqueAccounts: Array.isArray(row?.accounts) ? row.accounts.length : 0,
  };
}

async function incrementFeeBumpStats(
  sourcePublicKey: string,
  feeStroops: number,
): Promise<void> {
  try {
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
      const accounts: string[] = Array.isArray(existing.accounts) ? existing.accounts as string[] : [];
      if (!accounts.includes(sourcePublicKey)) {
        await tx.feeBumpStat.update({
          where: { id: 'singleton' },
          data: { accounts: [...accounts, sourcePublicKey] },
        });
      }
    });
  } catch (err) {
    logger.warn('stellar.feeBumpStats.persist.failed', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Fee-bump wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an inner transaction with a FeeBumpTransaction so the platform account
 * pays the fee instead of the original sender.
 * @see https://developers.stellar.org/docs/learn/fundamentals/transactions/fee-bumps
 */
export function wrapWithFeeBump(
  innerTx: StellarSDK.Transaction,
  feeAccountSecret: string,
): StellarSDK.FeeBumpTransaction {
  const feeKeypair = StellarSDK.Keypair.fromSecret(feeAccountSecret);
  const networkPassphrase = isTestnet()
    ? StellarSDK.Networks.TESTNET
    : StellarSDK.Networks.PUBLIC;
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

// ---------------------------------------------------------------------------
// Horizon server singleton
// ---------------------------------------------------------------------------

let horizonServerUrl: string | undefined;
let horizonServer: StellarSDK.Horizon.Server | undefined;

/**
 * Return a cached Stellar Horizon server instance, re-creating it if the URL has changed.
 */
export function getHorizonServer(): StellarSDK.Horizon.Server {
  const { horizonUrl } = getConfig().stellar;
  if (!horizonServer || horizonUrl !== horizonServerUrl) {
    horizonServerUrl = horizonUrl;
    horizonServer = new StellarSDK.Horizon.Server(horizonUrl);
  }
  return horizonServer;
}

/** Timeout (ms) for Horizon calls. Reads HORIZON_TIMEOUT_MS env var, default 10 000. */
export function getHorizonTimeout(): number {
  return parseInt(process.env.HORIZON_TIMEOUT_MS ?? '10000', 10);
}

/**
 * Run a Horizon call with a timeout and circuit breaker.
 * Throws a 504-tagged error on timeout, or a 503-tagged error when the circuit is open.
 */
export async function withHorizonTimeout<T>(fn: () => Promise<T>): Promise<T> {
  const ms = getHorizonTimeout();
  return callWithCircuitBreaker(() => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = Object.assign(new Error('Horizon request timed out'), { isTimeout: true });
        reject(err);
      }, ms);
    });
    return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer!));
  });
}

const HORIZON_RETRY_BACKOFFS: number[] = [500, 1000, 2000];

function isTransientHorizonError(err: unknown): boolean {
  const e = err as Record<string, unknown>;
  const status = (e?.response as Record<string, unknown>)?.status ?? e?.status;
  if (status === 400 || status === 404 || status === 409) return false;
  if (status === 429 || status === 503) return true;
  if ((e as { isTimeout?: boolean })?.isTimeout) return true;
  const code = e?.code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET'
  )
    return true;
  return false;
}

/**
 * Run a Horizon call with timeout, circuit breaker, and exponential backoff retry.
 * Retries on 429, 503, and network timeouts (max 3 attempts: 500ms, 1s, 2s backoff).
 * Does NOT retry on 400, 404, or 409.
 */
export async function withHorizonRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= HORIZON_RETRY_BACKOFFS.length; attempt++) {
    try {
      const result = await withHorizonTimeout(fn);
      recordHorizonCall(false);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isTransientHorizonError(err) || attempt === HORIZON_RETRY_BACKOFFS.length) {
        recordHorizonCall(true);
        throw err;
      }
      const delay = HORIZON_RETRY_BACKOFFS[attempt];
      logger.warn('stellar.horizon.retry', { attempt: attempt + 1, delay, error: (err as Error).message });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  recordHorizonCall(true);
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the configured Stellar network is testnet.
 */
export function isTestnet(): boolean {
  return getConfig().stellar.network === 'testnet';
}

/**
 * Fund a testnet account via Friendbot (testnet only).
 */
export async function fundAccount(
  publicKey: string,
): Promise<{ funded: boolean; publicKey: string }> {
  if (!isTestnet()) throw new Error('Only available on testnet');
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Friendbot funding failed: ${res.status} ${res.statusText}`);
  logger.debug('stellar.friendbotFunded', { publicKey });
  return { funded: true, publicKey };
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

/**
 * Generate a new Stellar keypair, fund it via Friendbot on testnet, and persist the user record.
 */
export async function createAccount(
  correlationId: string | null = null,
): Promise<{ publicKey: string; secretKey: string }> {
  return withSpan('stellar-service', 'stellar.createAccount', async (span: { setAttribute: (k: string, v: string) => void }) => {
    const pair = StellarSDK.Keypair.random();
    const publicKey = pair.publicKey();
    span.setAttribute('stellar.publicKey', publicKey);
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
      .catch((err: Error) =>
        logger.warn('db.user.upsert.failed', { error: err.message, correlationId }),
      );

    return {
      publicKey,
      secretKey: pair.secret(),
    };
  });
}

/**
 * Fetch all asset balances for a Stellar account from Horizon.
 */
export async function getBalance(
  publicKey: string,
  correlationId: string | null = null,
): Promise<{ publicKey: string; balances: AssetBalance[] }> {
  return withSpan('stellar-service', 'stellar.getBalance', async (span: { setAttribute: (k: string, v: string) => void }) => {
    span.setAttribute('stellar.publicKey', publicKey);
    logger.debug('stellar.getBalance', { publicKey, correlationId });
    return getCachedBalance(publicKey, async () => {
      const account = await withHorizonRetry(() => getHorizonServer().loadAccount(publicKey));
      const balances: AssetBalance[] = account.balances.map((b) => ({
        asset: b.asset_type === 'native' ? 'XLM' : `${(b as { asset_code: string }).asset_code}:${(b as { asset_issuer: string }).asset_issuer}`,
        balance: b.balance,
      }));
      logger.info('stellar.balanceFetched', { publicKey, balances, correlationId });
      return { publicKey, balances };
    });
  });
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

/**
 * Send a payment on the Stellar network. Automatically wraps in a fee-bump when the
 * sender's XLM balance is below FEE_BUMP_THRESHOLD_XLM and PLATFORM_FEE_ACCOUNT_SECRET is set.
 * Persists the transaction to the database and emits a PaymentSent event.
 */
export async function sendPayment(
  sourceSecret: string,
  destination: string,
  amount: string | number,
  assetCode = 'XLM',
  memo: string | null = null,
  memoType: MemoType = 'text',
  correlationId: string | null = null,
): Promise<PaymentResult> {
  const txCorrelationId = correlationId ?? randomUUID();
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.sendPayment.start', {
    source: sourcePublicKey,
    destination,
    amount,
    assetCode,
    memo,
    memoType,
    correlationId: txCorrelationId,
  });

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  if (assetCode !== 'XLM' && !getIssuer(assetCode)) {
    throw new Error('ASSET_ISSUER is required for non-XLM payments');
  }

  const asset =
    assetCode === 'XLM'
      ? StellarSDK.Asset.native()
      : new StellarSDK.Asset(assetCode, getIssuer(assetCode) as string);

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
    let stellarMemo: StellarSDK.Memo;
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

  const platformFeeSecret = process.env.PLATFORM_FEE_ACCOUNT_SECRET;
  const feeBumpThreshold = parseFloat(process.env.FEE_BUMP_THRESHOLD_XLM ?? '2');
  let txToSubmit: StellarSDK.Transaction | StellarSDK.FeeBumpTransaction = transaction;
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
        correlationId: txCorrelationId,
      });
      await incrementFeeBumpStats(
        sourcePublicKey,
        StellarSDK.BASE_FEE * parseInt(process.env.FEE_BUMP_MULTIPLIER ?? '10', 10),
      );
    }
  }

  let result: StellarSDK.Horizon.HorizonApi.SubmitTransactionResponse;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(txToSubmit));
  } catch (err) {
    logger.error('stellar.sendPayment.failed', {
      source: sourcePublicKey,
      destination,
      amount,
      assetCode,
      error: (err as Error).message,
      correlationId: txCorrelationId,
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
    correlationId: txCorrelationId,
  });

  await invalidateBalanceCache(sourcePublicKey);

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'PaymentSent',
    data: {
      destination,
      amount,
      hash: result.hash,
      feeBump: usedFeeBump,
      memo,
      memoType,
      correlationId: txCorrelationId,
    },
    version: 1,
  });

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
    .catch((err: Error) =>
      logger.warn('db.transaction.save.failed', {
        error: err.message,
        correlationId: txCorrelationId,
      }),
    );

  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
    feeBump: usedFeeBump,
  };
}

// ---------------------------------------------------------------------------
// Trustlines
// ---------------------------------------------------------------------------

/**
 * Create a trustline for a non-XLM asset on an account.
 * No-ops if the trustline already exists.
 * @see https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines
 */
export async function createTrustline(
  sourceSecret: string,
  assetCode: string,
): Promise<TrustlineResult> {
  const issuer = getIssuer(assetCode);
  if (!issuer) throw new Error(`Unknown asset or missing issuer for ${assetCode}`);

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  const correlationId = randomUUID();
  logger.info('stellar.createTrustline', { publicKey: sourcePublicKey, assetCode, correlationId });

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  const alreadyTrusted = sourceAccount.balances.some(
    (b) =>
      (b as { asset_code?: string }).asset_code === assetCode &&
      (b as { asset_issuer?: string }).asset_issuer === issuer,
  );
  if (alreadyTrusted) {
    logger.info('stellar.createTrustline.exists', {
      publicKey: sourcePublicKey,
      assetCode,
      correlationId,
    });
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

  let result: StellarSDK.Horizon.HorizonApi.SubmitTransactionResponse;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    logger.error('stellar.createTrustline.failed', {
      publicKey: sourcePublicKey,
      assetCode,
      correlationId,
      error: (err as Error).message,
    });
    throw err;
  }

  logger.info('stellar.createTrustline.success', {
    publicKey: sourcePublicKey,
    assetCode,
    correlationId,
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
 */
export async function removeTrustline(
  sourceSecret: string,
  assetCode: string,
): Promise<TrustlineResult> {
  const issuer = getIssuer(assetCode);
  if (!issuer) throw new Error(`Unknown asset or missing issuer for ${assetCode}`);

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  const correlationId = randomUUID();
  logger.info('stellar.removeTrustline', { publicKey: sourcePublicKey, assetCode, correlationId });

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  const balance = sourceAccount.balances.find(
    (b) =>
      (b as { asset_code?: string }).asset_code === assetCode &&
      (b as { asset_issuer?: string }).asset_issuer === issuer,
  ) as { balance: string } | undefined;

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

  let result: StellarSDK.Horizon.HorizonApi.SubmitTransactionResponse;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    logger.error('stellar.removeTrustline.failed', {
      publicKey: sourcePublicKey,
      assetCode,
      correlationId,
      error: (err as Error).message,
    });
    throw err;
  }

  logger.info('stellar.removeTrustline.success', {
    publicKey: sourcePublicKey,
    assetCode,
    correlationId,
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
 * List all non-native trustlines held by an account.
 */
export async function getTrustlines(publicKey: string): Promise<TrustlineInfo[]> {
  logger.debug('stellar.getTrustlines', { publicKey });
  const account = await withHorizonRetry(() => getHorizonServer().loadAccount(publicKey));
  return account.balances
    .filter((b) => b.asset_type !== 'native')
    .map((b) => {
      const bal = b as {
        asset_code: string;
        asset_issuer: string;
        balance: string;
        limit: string;
        is_authorized: boolean;
      };
      return {
        assetCode: bal.asset_code,
        issuer: bal.asset_issuer,
        balance: bal.balance,
        limit: bal.limit,
        authorized: bal.is_authorized === true,
      };
    });
}

// ---------------------------------------------------------------------------
// Transaction history
// ---------------------------------------------------------------------------

export interface GetTransactionsOptions {
  cursor?: string;
  limit?: number;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Fetch paginated transaction history for an account from Stellar Horizon.
 */
export async function getTransactions(
  publicKey: string,
  { cursor, limit = 10, type, dateFrom, dateTo }: GetTransactionsOptions = {},
): Promise<TransactionPage> {
  let builder = getHorizonServer()
    .transactions()
    .forAccount(publicKey)
    .order('desc')
    .limit(limit);
  if (cursor) builder = builder.cursor(cursor);

  const page = await withHorizonRetry(() => builder.call());

  let records: TransactionRecord[] = await Promise.all(
    page.records.map(async (tx) => {
      const ops = await tx.operations();
      const op = ops.records[0] as Record<string, unknown> | undefined;
      const opType = (op?.type as string) ?? 'unknown';
      const amount = (op?.amount as string) ?? null;
      const asset =
        op?.asset_type === 'native'
          ? 'XLM'
          : op?.asset_code
            ? `${op.asset_code as string}`
            : null;
      const counterparty =
        opType === 'payment'
          ? (op?.from as string) === publicKey
            ? (op?.to as string)
            : (op?.from as string)
          : null;
      const direction =
        opType === 'payment'
          ? (op?.from as string) === publicKey
            ? 'sent'
            : 'received'
          : null;

      return {
        id: tx.id,
        hash: tx.hash,
        type: opType,
        direction: direction as 'sent' | 'received' | null,
        amount,
        asset,
        counterparty,
        date: tx.created_at,
        fee: tx.fee_charged,
        successful: tx.successful,
        memo: tx.memo ?? null,
        cursor: tx.paging_token,
        ledger: (tx as unknown as { ledger_attr: number }).ledger_attr,
        envelopeXdr: tx.envelope_xdr,
      };
    }),
  );

  if (type) records = records.filter((r) => r.type === type);
  if (dateFrom) records = records.filter((r) => new Date(r.date) >= new Date(dateFrom));
  if (dateTo) records = records.filter((r) => new Date(r.date) <= new Date(dateTo));

  return {
    records,
    nextCursor:
      page.records.length === limit
        ? page.records[page.records.length - 1].paging_token
        : null,
    hasMore: page.records.length === limit,
  };
}

// ---------------------------------------------------------------------------
// Fee stats
// ---------------------------------------------------------------------------

/**
 * Retrieve current network fee statistics from Horizon with an XLM/USD conversion via the SDEX.
 */
export async function getFeeStats(): Promise<FeeStats> {
  return withSpan('stellar-service', 'stellar.getFeeStats', async () => {
    const stats = await withHorizonRetry(() => getHorizonServer().feeStats());
    const baseFeeStroops = parseInt(
      String((stats as unknown as Record<string, unknown>).last_ledger_base_fee ?? StellarSDK.BASE_FEE),
    );
    const feeStroops = parseInt(
      String(
        (stats.fee_charged as unknown as Record<string, unknown>)?.p50 ?? StellarSDK.BASE_FEE,
      ),
    );
    const feeXLM = feeStroops / 1e7;
    const baseFeeXLM = baseFeeStroops / 1e7;
    const surgeMultiplier = baseFeeStroops > 0 ? feeStroops / baseFeeStroops : 1;

    let xlmUsd: number | null = null;
    try {
      const usdc = new StellarSDK.Asset('USDC', getIssuer('USDC') as string);
      const book = await withHorizonRetry(() =>
        getHorizonServer().orderbook(StellarSDK.Asset.native(), usdc).limit(1).call(),
      );
      const ask = parseFloat((book.asks as Array<{ price: string }>)?.[0]?.price);
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
      traditionalFeeUsd: 25,
      baseFeeStroops,
      baseFeeXLM: baseFeeXLM.toFixed(7),
      surgeMultiplier: surgeMultiplier.toFixed(2),
    };
  });
}

// ---------------------------------------------------------------------------
// Exchange rate
// ---------------------------------------------------------------------------

/**
 * Look up the best ask price between two assets using the Stellar SDEX order book.
 */
export async function getExchangeRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1.0;
  try {
    const fromAsset =
      from === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(from, getIssuer(from) as string);
    const toAsset =
      to === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(to, getIssuer(to) as string);
    const orderbook = await withHorizonRetry(() =>
      getHorizonServer().orderbook(fromAsset, toAsset).call(),
    );
    const bestAsk = (orderbook.asks as Array<{ price: string }>)?.[0]?.price;
    return bestAsk ? parseFloat(bestAsk) : null;
  } catch (err) {
    logger.warn('stellar.getExchangeRate.failed', { from, to, error: (err as Error).message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Network status
// ---------------------------------------------------------------------------

/**
 * Check the configured Horizon server's liveness and return network metadata.
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  return withSpan('stellar-service', 'stellar.getNetworkStatus', async (span: { setAttribute: (k: string, v: string) => void }) => {
    const { horizonUrl } = getConfig().stellar;
    span.setAttribute('stellar.horizonUrl', horizonUrl);
    try {
      const root = await withHorizonRetry(() => getHorizonServer().root());
      const r = root as unknown as {
        horizon_version?: string;
        network_passphrase?: string;
        current_protocol_version?: number;
      };
      const status: NetworkStatus = {
        network: isTestnet() ? 'testnet' : 'mainnet',
        horizonUrl,
        online: true,
        horizonVersion: r.horizon_version,
        networkPassphrase: r.network_passphrase,
        currentProtocolVersion: r.current_protocol_version,
      };
      logger.debug('stellar.networkStatus', status);
      return status;
    } catch (err) {
      logger.warn('stellar.networkStatus.offline', { error: (err as Error).message });
      return {
        network: isTestnet() ? 'testnet' : 'mainnet',
        horizonUrl,
        online: false,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Horizon latency monitor
// ---------------------------------------------------------------------------

const LATENCY_PING_INTERVAL_MS = 30_000;
let lastLatencyMeasurement: LatencyMeasurement | null = null;
let latencyPingTimer: ReturnType<typeof setInterval> | null = null;

export async function pingHorizonLatency(): Promise<LatencyMeasurement> {
  const { horizonUrl } = getConfig().stellar;
  const startedAt = Date.now();
  try {
    await getHorizonServer().root();
    lastLatencyMeasurement = {
      latencyMs: Date.now() - startedAt,
      horizonUrl,
      online: true,
      measuredAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn('stellar.latencyPing.failed', { error: (err as Error).message });
    lastLatencyMeasurement = {
      latencyMs: null,
      horizonUrl,
      online: false,
      measuredAt: new Date().toISOString(),
    };
  }
  return lastLatencyMeasurement!;
}

export function getLastHorizonLatency(): LatencyMeasurement | null {
  return lastLatencyMeasurement;
}

export function startHorizonLatencyMonitor(
  intervalMs = LATENCY_PING_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  if (latencyPingTimer) return latencyPingTimer;
  void pingHorizonLatency();
  latencyPingTimer = setInterval(pingHorizonLatency, intervalMs);
  (latencyPingTimer as unknown as { unref?: () => void }).unref?.();
  return latencyPingTimer;
}

export function stopHorizonLatencyMonitor(): void {
  if (latencyPingTimer) clearInterval(latencyPingTimer);
  latencyPingTimer = null;
}

// ---------------------------------------------------------------------------
// Account merge
// ---------------------------------------------------------------------------

/**
 * Merge a Stellar account into a destination account, transferring all remaining XLM.
 * All trustlines and non-XLM balances must be removed before merging.
 */
export async function mergeAccount(
  sourceSecret: string,
  destination: string,
): Promise<MergeAccountResult> {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  const correlationId = randomUUID();
  logger.info('stellar.mergeAccount.start', { source: sourcePublicKey, destination, correlationId });

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

  let result: StellarSDK.Horizon.HorizonApi.SubmitTransactionResponse;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
  } catch (err) {
    logger.error('stellar.mergeAccount.failed', {
      source: sourcePublicKey,
      destination,
      correlationId,
      error: (err as Error).message,
    });
    throw err;
  }

  logger.info('stellar.mergeAccount.success', {
    source: sourcePublicKey,
    destination,
    correlationId,
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

// ---------------------------------------------------------------------------
// Build unsigned XDR (multisig / hardware wallet workflows)
// ---------------------------------------------------------------------------

/**
 * Build an unsigned XDR transaction envelope for a payment without submitting it.
 * Useful for multisig workflows and hardware wallet signing.
 */
export async function buildUnsignedXdr(
  sourceSecret: string,
  destination: string,
  amount: string | number,
  assetCode = 'XLM',
  memo: string | null = null,
  memoType: MemoType = 'text',
): Promise<UnsignedXdrResult> {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();

  const sourceAccount = await withHorizonRetry(() =>
    getHorizonServer().loadAccount(sourcePublicKey),
  );

  if (assetCode !== 'XLM' && !getIssuer(assetCode)) {
    throw new Error('ASSET_ISSUER is required for non-XLM payments');
  }

  const asset =
    assetCode === 'XLM'
      ? StellarSDK.Asset.native()
      : new StellarSDK.Asset(assetCode, getIssuer(assetCode) as string);

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
    let stellarMemo: StellarSDK.Memo;
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
  return {
    xdr: transaction.toEnvelope().toXDR('base64'),
  };
}
