import * as StellarSDK from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
import { eventMonitor } from '../eventSourcing/index.js';

dotenv.config();

const server = new StellarSDK.Horizon.Server(process.env.HORIZON_URL);
const isTestnet = process.env.STELLAR_NETWORK === 'testnet';

export async function createAccount() {
  const pair = StellarSDK.Keypair.random();
  const publicKey = pair.publicKey();
  
  if (isTestnet) {
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
  const account = await server.loadAccount(publicKey);
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
  const sourceKeypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
  
  const asset = assetCode === 'XLM' 
    ? StellarSDK.Asset.native() 
    : new StellarSDK.Asset(assetCode, process.env.ASSET_ISSUER);
  
  const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: isTestnet 
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
  const result = await server.submitTransaction(transaction);

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

export async function getExchangeRate(from, to) {
  // Placeholder - integrate with price oracle or DEX
  return 1.0;
}

export async function getNetworkStatus() {
  try {
    const root = await server.root();
    return {
      network: isTestnet ? 'testnet' : 'mainnet',
      horizonUrl: process.env.HORIZON_URL,
      online: true,
      horizonVersion: root.horizon_version,
      networkPassphrase: root.network_passphrase,
      currentProtocolVersion: root.current_protocol_version,
    };
  } catch {
    return {
      network: isTestnet ? 'testnet' : 'mainnet',
      horizonUrl: process.env.HORIZON_URL,
      online: false,
    };
  }
}
