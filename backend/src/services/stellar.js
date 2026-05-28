import * as StellarSDK from '@stellar/stellar-sdk';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';
import { getIssuer } from '../config/assets.js';
import logger from '../config/logger.js';
import prisma from '../db/client.js';

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
        create: { id: 'singleton', total: 1, totalFeeStroops: feeStroops, accounts: [sourcePublicKey] },
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
 * Wraps an inner transaction with a FeeBumpTransaction so the platform
 * account pays the fee instead of the buyer.
 */
export function wrapWithFeeBump(innerTx, feeAccountSecret) {
  const feeKeypair = StellarSDK.Keypair.fromSecret(feeAccountSecret);
  const networkPassphrase = isTestnet()
    ? StellarSDK.Networks.TESTNET
    : StellarSDK.Networks.PUBLIC;

  const multiplier = parseInt(process.env.FEE_BUMP_MULTIPLIER ?? '10', 10);
  const feeBumpTx = StellarSDK.TransactionBuilder.buildFeeBumpTransaction(
    feeKeypair,
    StellarSDK.BASE_FEE * multiplier,
    innerTx,
    networkPassphrase
  );
  feeBumpTx.sign(feeKeypair);
  return feeBumpTx;
}

let horizonServerUrl;
let horizonServer;

export function getHorizonServer() {
  const { horizonUrl } = getConfig().stellar;
  if (!horizonServer || horizonUrl !== horizonServerUrl) {
    horizonServerUrl = horizonUrl;
    horizonServer = new StellarSDK.Horizon.Server(horizonUrl);
  }
  return horizonServer;
}

export function isTestnet() {
  return getConfig().stellar.network === 'testnet';
}

export async function fundAccount(publicKey) {
  if (!isTestnet()) throw new Error('Only available on testnet');
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Friendbot funding failed: ${res.status} ${res.statusText}`);
  logger.debug('stellar.friendbotFunded', { publicKey });
  return { funded: true, publicKey };
}

export async function createAccount() {
  const pair = StellarSDK.Keypair.random();
  const publicKey = pair.publicKey();
  logger.info('stellar.createAccount', { publicKey });
  
  if (isTestnet()) {
    const friendbotRes = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    if (!friendbotRes.ok) {
      throw new Error(`Friendbot funding failed: ${friendbotRes.status} ${friendbotRes.statusText}`);
    }
    logger.debug('stellar.friendbotFunded', { publicKey });
    await eventMonitor.publishEvent(publicKey, {
      type: 'AccountFunded',
      data: { publicKey },
      version: 1
    });
  }

  await eventMonitor.publishEvent(publicKey, {
    type: 'AccountCreated',
    data: { publicKey },
    version: 1
  });

  await prisma.user.upsert({
    where: { publicKey },
    update: {},
    create: { publicKey },
  }).catch(err => logger.warn('db.user.upsert.failed', { error: err.message }));
  
  return {
    publicKey,
    secretKey: pair.secret()
  };
}

export async function getBalance(publicKey) {
  logger.debug('stellar.getBalance', { publicKey });
  const account = await getHorizonServer().loadAccount(publicKey);
  const balances = account.balances.map(b => ({
    asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`,
    balance: b.balance
  }));

  logger.info('stellar.balanceFetched', { publicKey, balances });

  return { publicKey, balances };
}

export async function sendPayment(sourceSecret, destination, amount, assetCode = 'XLM', memo = null, memoType = 'text') {
  const { assetIssuer } = getConfig().stellar;
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.sendPayment.start', { source: sourcePublicKey, destination, amount, assetCode, memo, memoType });

  const sourceAccount = await getHorizonServer().loadAccount(sourcePublicKey);
  
  if (assetCode !== 'XLM' && !assetIssuer) {
    throw new Error('ASSET_ISSUER is required for non-XLM payments');
  }

  const asset = assetCode === 'XLM' 
    ? StellarSDK.Asset.native() 
    : new StellarSDK.Asset(assetCode, getIssuer(assetCode));
  
  const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet() 
      ? StellarSDK.Networks.TESTNET 
      : StellarSDK.Networks.PUBLIC
  })
    .addOperation(StellarSDK.Operation.payment({
      destination,
      asset,
      amount: amount.toString()
    }));

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
    const xlmBalance = sourceAccount.balances.find(b => b.asset_type === 'native');
    const xlmAmount = parseFloat(xlmBalance?.balance ?? '0');
    if (xlmAmount < feeBumpThreshold) {
      txToSubmit = wrapWithFeeBump(transaction, platformFeeSecret);
      usedFeeBump = true;
      logger.info('stellar.feeBump.applied', {
        source: sourcePublicKey,
        xlmBalance: xlmAmount,
        threshold: feeBumpThreshold,
      });
      // Track stats for cost monitoring
      feeBumpStats.total += 1;
      feeBumpStats.totalFeeStroops += StellarSDK.BASE_FEE * parseInt(process.env.FEE_BUMP_MULTIPLIER ?? '10', 10);
      feeBumpStats.accounts.add(sourcePublicKey);
    }
  }

  let result;
  try {
    result = await getHorizonServer().submitTransaction(txToSubmit);
  } catch (err) {
    logger.error('stellar.sendPayment.failed', { source: sourcePublicKey, destination, amount, assetCode, error: err.message });
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
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'PaymentSent',
    data: { destination, amount, hash: result.hash, feeBump: usedFeeBump, memo, memoType },
    version: 1
  });

  // Persist transaction — ensure both users exist first
  await prisma.$transaction(async (tx) => {
    const [sender, recipient] = await Promise.all([
      tx.user.upsert({ where: { publicKey: sourcePublicKey }, update: {}, create: { publicKey: sourcePublicKey } }),
      tx.user.upsert({ where: { publicKey: destination },    update: {}, create: { publicKey: destination } }),
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
        memoType: memo ? (memoType || 'text') : null,
      },
    });
  }).catch(err => logger.warn('db.transaction.save.failed', { error: err.message }));
  
  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
    feeBump: usedFeeBump,
  };
}

export async function createTrustline(sourceSecret, assetCode) {
  const issuer = getIssuer(assetCode);
  if (!issuer) throw new Error(`Unknown asset or missing issuer for ${assetCode}`);

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.createTrustline', { publicKey: sourcePublicKey, assetCode });

  const sourceAccount = await getHorizonServer().loadAccount(sourcePublicKey);

  const alreadyTrusted = sourceAccount.balances.some(
    b => b.asset_code === assetCode && b.asset_issuer === issuer
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
    result = await getHorizonServer().submitTransaction(transaction);
  } catch (err) {
    logger.error('stellar.createTrustline.failed', { publicKey: sourcePublicKey, assetCode, error: err.message });
    throw err;
  }

  logger.info('stellar.createTrustline.success', { publicKey: sourcePublicKey, assetCode, hash: result.hash });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'TrustlineCreated',
    data: { assetCode, issuer, hash: result.hash },
    version: 1,
  });

  return { hash: result.hash, assetCode, issuer };
}

export async function removeTrustline(sourceSecret, assetCode) {
  const issuer = getIssuer(assetCode);
  if (!issuer) throw new Error(`Unknown asset or missing issuer for ${assetCode}`);

  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.removeTrustline', { publicKey: sourcePublicKey, assetCode });

  const sourceAccount = await getHorizonServer().loadAccount(sourcePublicKey);

  const balance = sourceAccount.balances.find(
    b => b.asset_code === assetCode && b.asset_issuer === issuer
  );
  if (!balance) {
    throw new Error(`No trustline found for ${assetCode}`);
  }
  if (parseFloat(balance.balance) !== 0) {
    throw new Error(`Cannot remove trustline: balance is non-zero (${balance.balance} ${assetCode})`);
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
    result = await getHorizonServer().submitTransaction(transaction);
  } catch (err) {
    logger.error('stellar.removeTrustline.failed', { publicKey: sourcePublicKey, assetCode, error: err.message });
    throw err;
  }

  logger.info('stellar.removeTrustline.success', { publicKey: sourcePublicKey, assetCode, hash: result.hash });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'TrustlineRemoved',
    data: { assetCode, issuer, hash: result.hash },
    version: 1,
  });

  return { hash: result.hash, assetCode, issuer };
}

export async function getTransactions(publicKey, { cursor, limit = 10, type, dateFrom, dateTo } = {}) {
  let builder = getHorizonServer().transactions().forAccount(publicKey).order('desc').limit(limit);
  if (cursor) builder = builder.cursor(cursor);

  const page = await builder.call();

  let records = await Promise.all(
    page.records.map(async (tx) => {
      const ops = await tx.operations();
      const op = ops.records[0];
      const opType = op?.type ?? 'unknown';
      const amount = op?.amount ?? null;
      const asset = op?.asset_type === 'native' ? 'XLM'
        : op?.asset_code ? `${op.asset_code}` : null;
      const counterparty = opType === 'payment'
        ? (op.from === publicKey ? op.to : op.from)
        : null;
      const direction = opType === 'payment'
        ? (op.from === publicKey ? 'sent' : 'received')
        : null;

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
    })
  );

  if (type) records = records.filter(r => r.type === type);
  if (dateFrom) records = records.filter(r => new Date(r.date) >= new Date(dateFrom));
  if (dateTo) records = records.filter(r => new Date(r.date) <= new Date(dateTo));

  return {
    records,
    nextCursor: page.records.length === limit ? page.records[page.records.length - 1].paging_token : null,
    hasMore: page.records.length === limit,
  };
}

export async function getFeeStats() {
  const stats = await getHorizonServer().feeStats();
  const feeStroops = parseInt(stats.fee_charged?.p50 ?? StellarSDK.BASE_FEE);
  const feeXLM = feeStroops / 1e7;

  // Fetch XLM/USD price via Stellar SDEX (XLM/USDC order book)
  let xlmUsd = null;
  try {
    const usdc = new StellarSDK.Asset('USDC', getIssuer('USDC'));
    const book = await getHorizonServer().orderbook(StellarSDK.Asset.native(), usdc).limit(1).call();
    const ask = parseFloat(book.asks?.[0]?.price);
    if (ask > 0) xlmUsd = ask;
  } catch (_) {}

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



export async function getExchangeRate(from, to) {
  if (from === to) return 1.0;
  try {
    const fromAsset = from === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(from, getIssuer(from));
    const toAsset   = to   === 'XLM' ? StellarSDK.Asset.native() : new StellarSDK.Asset(to,   getIssuer(to));
    const orderbook = await getHorizonServer().orderbook(fromAsset, toAsset).call();
    const bestAsk = orderbook.asks?.[0]?.price;
    return bestAsk ? parseFloat(bestAsk) : null;
  } catch (err) {
    logger.warn('stellar.getExchangeRate.failed', { from, to, error: err.message });
    return null;
  }
}

export async function getNetworkStatus() {
  const { horizonUrl } = getConfig().stellar;
  try {
    const root = await getHorizonServer().root();
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
export async function getTrustlines(publicKey) {
  logger.debug('stellar.getTrustlines', { publicKey });
  const account = await getHorizonServer().loadAccount(publicKey);
  return account.balances
    .filter(b => b.asset_type !== 'native')
    .map(b => ({
      assetCode: b.asset_code,
      issuer: b.asset_issuer,
      balance: b.balance,
      limit: b.limit,
      authorized: b.is_authorized === true,
    }));
}

export async function mergeAccount(sourceSecret, destination) {
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = sourceKeypair.publicKey();
  logger.info('stellar.mergeAccount.start', { source: sourcePublicKey, destination });

  const sourceAccount = await getHorizonServer().loadAccount(sourcePublicKey);

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
    result = await getHorizonServer().submitTransaction(transaction);
  } catch (err) {
    logger.error('stellar.mergeAccount.failed', { source: sourcePublicKey, destination, error: err.message });
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
