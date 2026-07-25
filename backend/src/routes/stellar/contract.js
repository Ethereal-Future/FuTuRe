import express from 'express';
import { body } from 'express-validator';
import * as StellarSDK from '@stellar/stellar-sdk';
import { validate } from '../../middleware/validate.js';

const router = express.Router();

function getSorobanServer() {
  const rpcUrl = process.env.SOROBAN_RPC_URL
    || (process.env.STELLAR_NETWORK === 'mainnet'
      ? 'https://mainnet.sorobanrpc.com'
      : 'https://soroban-testnet.stellar.org');
  return new StellarSDK.rpc.Server(rpcUrl);
}

function scValFromJson(value) {
  if (typeof value === 'boolean') return StellarSDK.nativeToScVal(value);
  if (typeof value === 'number') return StellarSDK.nativeToScVal(value, { type: 'i128' });
  if (typeof value === 'string' && StellarSDK.StrKey.isValidEd25519PublicKey(value)) {
    return StellarSDK.nativeToScVal(StellarSDK.Address.fromString(value));
  }
  return StellarSDK.nativeToScVal(value);
}

router.post(
  '/invoke',
  body('functionName').isString().trim().notEmpty(),
  body('args').optional().isArray(),
  body('sourceSecret').optional().isString().trim().notEmpty(),
  body('contractAddress').optional().isString().trim().notEmpty(),
  validate,
  async (req, res) => {
    const contractAddress = req.body.contractAddress || process.env.STELLAR_CONTRACT_ADDRESS;
    if (!contractAddress) {
      return res.status(503).json({ error: 'STELLAR_CONTRACT_ADDRESS is not configured' });
    }
    if (!req.body.sourceSecret) {
      return res.status(400).json({ error: 'sourceSecret is required to sign Soroban invocations' });
    }

    try {
      const sourceKeypair = StellarSDK.Keypair.fromSecret(req.body.sourceSecret);
      const server = getSorobanServer();
      const sourceAccount = await server.getAccount(sourceKeypair.publicKey());
      const contract = new StellarSDK.Contract(contractAddress);
      const operation = contract.call(
        req.body.functionName,
        ...(req.body.args || []).map(scValFromJson),
      );
      const networkPassphrase = process.env.STELLAR_NETWORK === 'mainnet'
        ? StellarSDK.Networks.PUBLIC
        : StellarSDK.Networks.TESTNET;
      const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
        fee: StellarSDK.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(60)
        .build();

      const prepared = await server.prepareTransaction(transaction);
      prepared.sign(sourceKeypair);
      const submitted = await server.sendTransaction(prepared);

      res.json({
        contractAddress,
        functionName: req.body.functionName,
        hash: submitted.hash,
        status: submitted.status,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to invoke Soroban contract', details: error.message });
    }
  },
);

export default router;
