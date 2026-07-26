import StellarSdk from 'stellar-sdk';
import { horizonServer, networkPassphrase } from '../config/stellar.js';
import logger from '../config/logger.js';

const BASE_FEE = '100'; // in stroops (0.01 XLM)
const MINIMUM_DEPOSIT = '1'; // minimum deposit in native units
const MINIMUM_WITHDRAW = '1'; // minimum shares to withdraw

export async function estimateDepositFees(poolId, amountA, amountB, slippageTolerance) {
  try {
    if (!poolId || !amountA || !amountB) {
      throw new Error('Missing required parameters: poolId, amountA, amountB');
    }

    const pool = await horizonServer.liquidityPools().liquidityPoolId(poolId).call();

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    // Calculate shares to be received (constant product formula)
    const reserveA = parseFloat(pool.reserves[0].amount);
    const reserveB = parseFloat(pool.reserves[1].amount);
    const totalShares = parseFloat(pool.total_shares);

    const depositAmt = Math.min(
      (amountA * totalShares) / reserveA,
      (amountB * totalShares) / reserveB
    );

    const baseFee = StellarSdk.BASE_FEE;
    const networkFee = baseFee * 1; // Single operation fee

    // Calculate actual ratio shift
    const newReserveA = reserveA + amountA;
    const newReserveB = reserveB + amountB;
    const ratioShiftPct = Math.abs((newReserveB / newReserveA - reserveB / reserveA) / (reserveB / reserveA)) * 100;

    return {
      baseFee: (networkFee / 10000000).toFixed(7),
      networkFee: (networkFee / 10000000).toFixed(7),
      sharesReceived: depositAmt.toFixed(7),
      ratioShiftPct: parseFloat(ratioShiftPct.toFixed(2)),
      minimumSharesWithSlippage: (
        depositAmt *
        (1 - parseFloat(slippageTolerance) / 100)
      ).toFixed(7),
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

export async function estimateWithdrawFees(poolId, shares, slippageTolerance) {
  try {
    if (!poolId || !shares) {
      throw new Error('Missing required parameters: poolId, shares');
    }

    const pool = await horizonServer.liquidityPools().liquidityPoolId(poolId).call();

    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const reserveA = parseFloat(pool.reserves[0].amount);
    const reserveB = parseFloat(pool.reserves[1].amount);
    const totalShares = parseFloat(pool.total_shares);

    // Calculate amounts to be received
    const amountA = (shares * reserveA) / totalShares;
    const amountB = (shares * reserveB) / totalShares;

    const baseFee = StellarSdk.BASE_FEE;
    const networkFee = baseFee * 1;

    const newReserveA = reserveA - amountA;
    const newReserveB = reserveB - amountB;
    const ratioShiftPct = Math.abs((newReserveB / newReserveA - reserveB / reserveA) / (reserveB / reserveA)) * 100;

    return {
      baseFee: (networkFee / 10000000).toFixed(7),
      networkFee: (networkFee / 10000000).toFixed(7),
      amountA: amountA.toFixed(7),
      amountB: amountB.toFixed(7),
      ratioShiftPct: parseFloat(ratioShiftPct.toFixed(2)),
      minimumAmountAWithSlippage: (amountA * (1 - parseFloat(slippageTolerance) / 100)).toFixed(7),
      minimumAmountBWithSlippage: (amountB * (1 - parseFloat(slippageTolerance) / 100)).toFixed(7),
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

export async function executeDeposit(sourceSecret, poolId, amountA, amountB, slippageTolerance) {
  try {
    if (!sourceSecret || !poolId || !amountA || !amountB) {
      throw new Error('Missing required parameters');
    }

    const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
    const sourceAccount = await horizonServer.loadAccount(keypair.publicKey());

    const estimate = await estimateDepositFees(poolId, amountA, amountB, slippageTolerance);

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.liquidityPoolDeposit({
          liquidityPoolId: poolId,
          maxAmountA: amountA.toString(),
          maxAmountB: amountB.toString(),
          minPrice: '0.1', // Placeholder
          maxPrice: '10', // Placeholder
        })
      )
      .setTimeout(300)
      .build();

    transaction.sign(keypair);
    const result = await horizonServer.submitTransaction(transaction);

    logger.info('pool.deposit.success', {
      sourceAccount: keypair.publicKey(),
      poolId,
      amountA,
      amountB,
      hash: result.hash,
    });

    return {
      success: true,
      hash: result.hash,
      ledger: result.ledger,
      sharesReceived: estimate.sharesReceived,
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
      networkPassphrase,
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
