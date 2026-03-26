import * as StellarSDK from '@stellar/stellar-sdk';
import { eventMonitor } from '../eventSourcing/index.js';
import { getConfig } from '../config/env.js';

let horizonServerUrl;
let horizonServer;

function getHorizonServer() {
  const { horizonUrl } = getConfig().stellar;
  if (!horizonServer || horizonUrl !== horizonServerUrl) {
    horizonServerUrl = horizonUrl;
    horizonServer = new StellarSDK.Horizon.Server(horizonUrl);
  }
  return horizonServer;
}

function isTestnet() {
  return getConfig().stellar.network === 'testnet';
}

export async function createAccount() {
  const pair = StellarSDK.Keypair.random();
  const publicKey = pair.publicKey();
  
  if (isTestnet()) {
    await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    await eventMonitor.publishEvent(publicKey, {
      type: 'AccountFunded',
      data: { publicKey },
      version: 1
    });
  }

  await eventMonitor.publishEvent(publicKey, {
    type: 'AccountCreated',
    data: { publicKey, secretKey: pair.secret() },
    version: 1
  });
  
  return {
    publicKey,
    secretKey: pair.secret()
  };
}

export async function getBalance(publicKey) {
  const account = await getHorizonServer().loadAccount(publicKey);
  const balances = account.balances.map(b => ({
    asset: b.asset_type === 'native' ? 'XLM' : `${b.asset_code}:${b.asset_issuer}`,
    balance: b.balance
  }));

  await eventMonitor.publishEvent(publicKey, {
    type: 'BalanceChecked',
    data: { balances },
    version: 1
  });

  return {
    publicKey,
    balances
  };
}

export async function sendPayment(sourceSecret, destination, amount, assetCode = 'XLM') {
  const { assetIssuer } = getConfig().stellar;
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourceAccount = await getHorizonServer().loadAccount(sourceKeypair.publicKey());
  
  if (assetCode !== 'XLM' && !assetIssuer) {
    throw new Error('ASSET_ISSUER is required for non-XLM payments');
  }

  const asset = assetCode === 'XLM' 
    ? StellarSDK.Asset.native() 
    : new StellarSDK.Asset(assetCode, assetIssuer);
  
  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet() 
      ? StellarSDK.Networks.TESTNET 
      : StellarSDK.Networks.PUBLIC
  })
    .addOperation(StellarSDK.Operation.payment({
      destination,
      asset,
      amount: amount.toString()
    }))
    .setTimeout(30)
    .build();
  
  transaction.sign(sourceKeypair);
  const result = await getHorizonServer().submitTransaction(transaction);

  await eventMonitor.publishEvent(sourceKeypair.publicKey(), {
    type: 'PaymentSent',
    data: { destination, amount, hash: result.hash },
    version: 1
  });
  
  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful
  };
}

export async function getTransactionHistory(publicKey, { limit = 10, cursor } = {}) {
  let call = server.transactions().forAccount(publicKey).limit(limit).order('desc');
  if (cursor) call = call.cursor(cursor);
  const result = await call.call();
  return {
    publicKey,
    transactions: result.records.map(tx => ({
      id: tx.id,
      hash: tx.hash,
      createdAt: tx.created_at,
      successful: tx.successful,
      ledger: tx.ledger_attr,
      pagingToken: tx.paging_token,
    })),
    nextCursor: result.records.at(-1)?.paging_token ?? null,
  };
}

export async function getExchangeRate(from, to) {
  // Placeholder - integrate with price oracle or DEX
  return 1.0;
}

export async function getNetworkStatus() {
  const { horizonUrl } = getConfig().stellar;
  try {
    const root = await getHorizonServer().root();
    return {
      network: isTestnet() ? 'testnet' : 'mainnet',
      horizonUrl,
      online: true,
      horizonVersion: root.horizon_version,
      networkPassphrase: root.network_passphrase,
      currentProtocolVersion: root.current_protocol_version,
    };
  } catch {
    return {
      network: isTestnet() ? 'testnet' : 'mainnet',
      horizonUrl,
      online: false,
    };
  }
}
