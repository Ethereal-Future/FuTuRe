/**
 * Liquidity Pool Service
 *
 * Fixes applied:
 *   ISSUE-044: Import horizonServer and networkPassphrase from the canonical
 *              config/stellar.js (previously the file did not exist → fatal crash).
 *   ISSUE-047: All AMM pool share / amount calculations now use BigInt stroop
 *              arithmetic (1 unit = 10_000_000 stroops) instead of IEEE 754
 *              floating-point, eliminating rounding drift for large and
 *              micro-balance inputs.
 */

import * as StellarSdk from '@stellar/stellar-sdk';
import { horizonServer, getNetworkPassphrase } from '../config/stellar.js';
import logger from '../config/logger.js';

// Each trustline (subentry) requires a 0.5 XLM base reserve on Stellar.
const TRUSTLINE_RESERVE_XLM = 0.5;
// XLM stroops per unit (1 XLM = 10_000_000 stroops)
const STROOPS_PER_XLM = 10_000_000;

/**
 * Check whether `sourceAccount` already has a trustline for the given liquidity
 * pool share asset, and return the available XLM balance after accounting for
 * all subentry reserves and liabilities.
 *
 * @param {object} sourceAccount - Horizon account record (returned by loadAccount)
 * @param {string} poolId - Liquidity pool ID to check for
 * @returns {{ hasTrustline: boolean, availableXlm: number }}
 */
function inspectPoolTrustline(sourceAccount, poolId) {
  let xlmBalance = 0;
  let hasTrustline = false;

  for (const balance of sourceAccount.balances) {
    if (balance.asset_type === 'native') {
      xlmBalance = parseFloat(balance.balance);
    }
    if (
      balance.asset_type === 'liquidity_pool_shares' &&
      balance.liquidity_pool_id === poolId
    ) {
      hasTrustline = true;
    }
  }

  // Stellar minimum balance: (2 + subentry_count) * base_reserve (0.5 XLM each).
  // The account object exposes subentry_count directly.
  const subentryCount = sourceAccount.subentry_count ?? 0;
  const minimumBalance = (2 + subentryCount) * TRUSTLINE_RESERVE_XLM;
  // Also subtract selling liabilities from the native balance.
  const nativeBalance = sourceAccount.balances.find((b) => b.asset_type === 'native');
  const sellingLiabilities = parseFloat(nativeBalance?.selling_liabilities ?? '0');
  const availableXlm = xlmBalance - minimumBalance - sellingLiabilities;

  return { hasTrustline, availableXlm };
}

const BASE_FEE = '100'; // in stroops (0.01 XLM)
const MINIMUM_DEPOSIT = '1'; // minimum deposit in native units
const MINIMUM_WITHDRAW = '1'; // minimum shares to withdraw
// ── Stroop helpers ────────────────────────────────────────────────────────────

/** Number of stroops per stellar unit (7 decimal places). */
const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Convert a decimal string or number to stroops (BigInt).
 * Rounds to the nearest stroop; throws if the value is non-finite or negative.
 * @param {number|string} amount
 * @returns {bigint}
 */
function toStroops(amount) {
  // Multiply via string manipulation to avoid floating-point loss
  const str = typeof amount === 'number' ? amount.toFixed(7) : String(amount);
  const [intPart = '0', fracPart = ''] = str.split('.');
  // Pad / truncate fractional part to exactly 7 digits
  const frac7 = fracPart.padEnd(7, '0').slice(0, 7);
  return BigInt(intPart) * STROOPS_PER_UNIT + BigInt(frac7);
}

/**
 * Convert stroops (BigInt) back to a decimal string with 7 decimal places.
 * @param {bigint} stroops
 * @returns {string}
 */
function fromStroops(stroops) {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const intPart = abs / STROOPS_PER_UNIT;
  const fracPart = abs % STROOPS_PER_UNIT;
  const result = `${intPart}.${String(fracPart).padStart(7, '0')}`;
  return negative ? `-${result}` : result;
}

/**
 * Integer division that floors toward zero (matching stellar-core CPMM).
 * @param {bigint} numerator
 * @param {bigint} denominator
 * @returns {bigint}
 */
function divFloor(numerator, denominator) {
  if (denominator === 0n) throw new Error('Division by zero in pool math');
  return numerator / denominator; // BigInt `/` already floors toward zero
}

// ── Pool estimation (BigInt stroop math) ─────────────────────────────────────

/**
 * Estimate the fee and shares received for depositing into a Stellar liquidity
 * pool, without submitting a transaction.
 *
 * Calculation uses integer stroop arithmetic to match stellar-core CPMM logic,
 * avoiding IEEE 754 rounding drift (ISSUE-047).
 *
 * @param {string} poolId - Liquidity pool id
 * @param {number|string} amountA - Amount of the pool's first asset to deposit
 * @param {number|string} amountB - Amount of the pool's second asset to deposit
 * @param {number|string} slippageTolerance - Allowed slippage as a percentage (e.g. 1 for 1%)
 * @returns {Promise<{baseFee: string, networkFee: string, sharesReceived: string, ratioShiftPct: number, minimumSharesWithSlippage: string}>} Deposit estimate
 * @throws {Error} If required parameters are missing or the pool cannot be found
 */
export async function estimateDepositFees(poolId, amountA, amountB, slippageTolerance) {
  try {
    if (!poolId || !amountA || !amountB) {
      throw new Error('Missing required parameters: poolId, amountA, amountB');
    }

    const pool = await horizonServer.liquidityPools().liquidityPoolId(poolId).call();

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    // ── BigInt stroop arithmetic ──────────────────────────────────────────────
    const reserveA_s = toStroops(pool.reserves[0].amount);
    const reserveB_s = toStroops(pool.reserves[1].amount);
    const totalShares_s = toStroops(pool.total_shares);
    const amountA_s = toStroops(amountA);
    const amountB_s = toStroops(amountB);

    // shares = min(amountA * totalShares / reserveA, amountB * totalShares / reserveB)
    // Intermediate products use scaled arithmetic to keep precision:
    //   (amountA_s * totalShares_s) needs to be divided by reserveA_s.
    //   Both sides are already in stroop units, so the result is also in stroops.
    const sharesFromA = divFloor(amountA_s * totalShares_s, reserveA_s);
    const sharesFromB = divFloor(amountB_s * totalShares_s, reserveB_s);
    const depositShares_s = sharesFromA < sharesFromB ? sharesFromA : sharesFromB;

    // ── Ratio shift (float is fine here — it's only informational, not financial) ──
    const reserveA_f = Number(reserveA_s);
    const reserveB_f = Number(reserveB_s);
    const amountA_f = Number(amountA_s);
    const amountB_f = Number(amountB_s);
    const newRatioNum = (reserveB_f + amountB_f);
    const newRatioDen = (reserveA_f + amountA_f);
    const oldRatio = reserveB_f / reserveA_f;
    const newRatio = newRatioNum / newRatioDen;
    const ratioShiftPct = Math.abs((newRatio - oldRatio) / oldRatio) * 100;

    // ── Slippage on shares (BigInt) ───────────────────────────────────────────
    const slipBps = BigInt(Math.round(parseFloat(slippageTolerance) * 100)); // pct → bps
    const minShares_s = divFloor(depositShares_s * (10_000n - slipBps), 10_000n);

    // ── Fee (network fee is 1 operation × BASE_FEE stroops) ──────────────────
    const baseFeeStroops = BigInt(StellarSdk.BASE_FEE);
    const networkFeeStroops = baseFeeStroops; // single operation

    return {
      baseFee: fromStroops(networkFeeStroops),
      networkFee: fromStroops(networkFeeStroops),
      sharesReceived: fromStroops(depositShares_s),
      ratioShiftPct: parseFloat(ratioShiftPct.toFixed(2)),
      minimumSharesWithSlippage: fromStroops(minShares_s),
    };
  } catch (error) {
    logger.error('pool.estimate.deposit.error', {
      poolId,
      amountA,
      amountB,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Estimate the fee and asset amounts received for withdrawing shares from a
 * Stellar liquidity pool, without submitting a transaction.
 *
 * Calculation uses integer stroop arithmetic (ISSUE-047).
 *
 * @param {string} poolId - Liquidity pool id
 * @param {number|string} shares - Number of pool shares to redeem
 * @param {number|string} slippageTolerance - Allowed slippage as a percentage (e.g. 1 for 1%)
 * @returns {Promise<{baseFee: string, networkFee: string, amountA: string, amountB: string, ratioShiftPct: number, minimumAmountAWithSlippage: string, minimumAmountBWithSlippage: string}>} Withdrawal estimate
 * @throws {Error} If required parameters are missing or the pool cannot be found
 */
export async function estimateWithdrawFees(poolId, shares, slippageTolerance) {
  try {
    if (!poolId || !shares) {
      throw new Error('Missing required parameters: poolId, shares');
    }

    const pool = await horizonServer.liquidityPools().liquidityPoolId(poolId).call();

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    // ── BigInt stroop arithmetic ──────────────────────────────────────────────
    const reserveA_s = toStroops(pool.reserves[0].amount);
    const reserveB_s = toStroops(pool.reserves[1].amount);
    const totalShares_s = toStroops(pool.total_shares);
    const shares_s = toStroops(shares);

    // amountA = shares * reserveA / totalShares
    const amountA_s = divFloor(shares_s * reserveA_s, totalShares_s);
    const amountB_s = divFloor(shares_s * reserveB_s, totalShares_s);

    // ── Ratio shift (informational only) ─────────────────────────────────────
    const reserveA_f = Number(reserveA_s);
    const reserveB_f = Number(reserveB_s);
    const amountA_f = Number(amountA_s);
    const amountB_f = Number(amountB_s);
    const oldRatio = reserveB_f / reserveA_f;
    const newRatio = (reserveB_f - amountB_f) / (reserveA_f - amountA_f);
    const ratioShiftPct = Math.abs((newRatio - oldRatio) / oldRatio) * 100;

    // ── Slippage on withdrawal amounts (BigInt) ───────────────────────────────
    const slipBps = BigInt(Math.round(parseFloat(slippageTolerance) * 100));
    const minAmountA_s = divFloor(amountA_s * (10_000n - slipBps), 10_000n);
    const minAmountB_s = divFloor(amountB_s * (10_000n - slipBps), 10_000n);

    // ── Fee ───────────────────────────────────────────────────────────────────
    const networkFeeStroops = BigInt(StellarSdk.BASE_FEE);

    return {
      baseFee: fromStroops(networkFeeStroops),
      networkFee: fromStroops(networkFeeStroops),
      amountA: fromStroops(amountA_s),
      amountB: fromStroops(amountB_s),
      ratioShiftPct: parseFloat(ratioShiftPct.toFixed(2)),
      minimumAmountAWithSlippage: fromStroops(minAmountA_s),
      minimumAmountBWithSlippage: fromStroops(minAmountB_s),
    };
  } catch (error) {
    logger.error('pool.estimate.withdraw.error', {
      poolId,
      shares,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Submit a `liquidityPoolDeposit` operation to add liquidity to a Stellar liquidity pool.
 *
 * Before building the transaction, this function:
 *   1. Inspects the source account's balances for an existing pool-share trustline.
 *   2. If the trustline is absent, validates that the account has at least
 *      `TRUSTLINE_RESERVE_XLM` (0.5 XLM) of available reserve capacity, then
 *      prepends a `changeTrust` operation so the trustline is established atomically
 *      in the same transaction as the deposit.
 *
 * Submit a `liquidityPoolDeposit` operation to add liquidity to a Stellar
 * liquidity pool.
 * @param {string} sourceSecret - Secret key of the depositing account
 * @param {string} poolId - Liquidity pool id
 * @param {number|string} amountA - Max amount of the pool's first asset to deposit
 * @param {number|string} amountB - Max amount of the pool's second asset to deposit
 * @param {number|string} slippageTolerance - Allowed slippage as a percentage (e.g. 1 for 1%)
 * @returns {Promise<{success: boolean, hash: string, ledger: number, sharesReceived: string, trustlineCreated: boolean}>} Submission result
 * @throws {Error} If required parameters are missing, insufficient XLM reserve, or Horizon submission fails
 */
export async function executeDeposit(sourceSecret, poolId, amountA, amountB, slippageTolerance) {
  try {
    if (!sourceSecret || !poolId || !amountA || !amountB) {
      throw new Error('Missing required parameters');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    // ── ISSUE-051: Trustline check ──────────────────────────────────────────
    const { hasTrustline, availableXlm } = inspectPoolTrustline(sourceAccount, poolId);
    let trustlineCreated = false;

    if (!hasTrustline) {
      // Establishing a new trustline costs 0.5 XLM from the account's reserve.
      if (availableXlm < TRUSTLINE_RESERVE_XLM) {
        throw new Error(
          `Insufficient XLM reserve to establish pool share trustline. ` +
          `Available: ${availableXlm.toFixed(7)} XLM, required: ${TRUSTLINE_RESERVE_XLM} XLM.`
        );
      }
      trustlineCreated = true;
      logger.info('pool.deposit.trustlineRequired', {
        sourceAccount: keypair.publicKey(),
        poolId,
        availableXlm,
      });
    }
    // ───────────────────────────────────────────────────────────────────────

    const estimate = await estimateDepositFees(poolId, amountA, amountB, slippageTolerance);

    const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    // Prepend changeTrust if the account lacks a trustline for this pool's share asset.
    if (trustlineCreated) {
      txBuilder.addOperation(
        StellarSdk.Operation.changeTrust({
          asset: new StellarSdk.LiquidityPoolAsset(poolId),
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.liquidityPoolDeposit({
          liquidityPoolId: poolId,
          maxAmountA: amountA.toString(),
          maxAmountB: amountB.toString(),
          minPrice: '0.1', // Placeholder
          maxPrice: '10', // Placeholder
        })
      );
    }

    txBuilder.addOperation(
      StellarSdk.Operation.liquidityPoolDeposit({
        liquidityPoolId: poolId,
        maxAmountA: amountA.toString(),
        maxAmountB: amountB.toString(),
        minPrice: '0.1', // Placeholder
        maxPrice: '10', // Placeholder
      })
    );

    const transaction = txBuilder.setTimeout(300).build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('pool.deposit.success', {
      sourceAccount: keypair.publicKey(),
      poolId,
      amountA,
      amountB,
      trustlineCreated,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      sharesReceived: estimate.sharesReceived,
      trustlineCreated,
    };
  } catch (error) {
    logger.error('pool.deposit.error', {
      poolId,
      amountA,
      amountB,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Submit a `liquidityPoolWithdraw` operation to remove liquidity from a
 * Stellar liquidity pool.
 * @param {string} sourceSecret - Secret key of the withdrawing account
 * @param {string} poolId - Liquidity pool id
 * @param {number|string} shares - Number of pool shares to redeem
 * @param {number|string} slippageTolerance - Allowed slippage as a percentage (e.g. 1 for 1%)
 * @returns {Promise<{success: boolean, hash: string, ledger: number, amountA: string, amountB: string}>} Submission result
 * @throws {Error} If required parameters are missing or Horizon submission fails
 */
export async function executeWithdraw(sourceSecret, poolId, shares, slippageTolerance) {
  try {
    if (!sourceSecret || !poolId || !shares) {
      throw new Error('Missing required parameters');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    const estimate = await estimateWithdrawFees(poolId, shares, slippageTolerance);

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.liquidityPoolWithdraw({
          liquidityPoolId: poolId,
          shares: shares.toString(),
          minAmountA: estimate.minimumAmountAWithSlippage,
          minAmountB: estimate.minimumAmountBWithSlippage,
        })
      )
      .setTimeout(300)
      .build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('pool.withdraw.success', {
      sourceAccount: keypair.publicKey(),
      poolId,
      shares,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      amountA: estimate.amountA,
      amountB: estimate.amountB,
    };
  } catch (error) {
    logger.error('pool.withdraw.error', {
      poolId,
      shares,
      error: error.message,
    });
    throw error;
  }
}
