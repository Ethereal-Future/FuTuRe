import express from 'express';
import { body } from 'express-validator';
import * as StellarSDK from '@stellar/stellar-sdk';
import { validate } from '../../middleware/validate.js';

const router = express.Router();

function getSorobanServer() {
  const rpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (process.env.STELLAR_NETWORK === 'mainnet'
      ? 'https://mainnet.sorobanrpc.com'
      : 'https://soroban-testnet.stellar.org');
  return new StellarSDK.rpc.Server(rpcUrl);
}

function getNetworkPassphrase() {
  return process.env.STELLAR_NETWORK === 'mainnet'
    ? StellarSDK.Networks.PUBLIC
    : StellarSDK.Networks.TESTNET;
}

function scValFromJson(value) {
  if (typeof value === 'boolean') return StellarSDK.nativeToScVal(value);
  if (typeof value === 'number') return StellarSDK.nativeToScVal(value, { type: 'i128' });
  if (
    typeof value === 'string' &&
    StellarSDK.StrKey.isValidEd25519PublicKey(value)
  ) {
    return StellarSDK.nativeToScVal(StellarSDK.Address.fromString(value));
  }
  return StellarSDK.nativeToScVal(value);
}

/**
 * Extract structured Soroban diagnostic/result info from a failed RPC response.
 * Falls back gracefully when the fields are absent.
 */
function extractSorobanError(error) {
  const base = { message: error.message };

  // sendTransaction failure shape: error.response?.data?.result / diagnosticEvents
  const data = error.response?.data ?? error.data ?? {};
  if (data.status === 'ERROR') {
    return {
      ...base,
      status: data.status,
      errorResultXdr: data.errorResultXdr ?? null,
      diagnosticEvents: data.diagnosticEvents ?? [],
    };
  }

  // prepareTransaction / simulateTransaction failure shape
  if (data.error) {
    return {
      ...base,
      simulationError: data.error,
      diagnosticEvents: data.events ?? [],
    };
  }

  return base;
}

// ── Shared validators ────────────────────────────────────────────────────────

const contractAddressValidator = body('contractAddress')
  .optional()
  .isString()
  .trim()
  .notEmpty()
  .withMessage('contractAddress must be a non-empty string');

const functionNameValidator = body('functionName')
  .isString()
  .trim()
  .notEmpty()
  .withMessage('functionName is required');

const argsValidator = body('args').optional().isArray().withMessage('args must be an array');

const sourcePublicKeyValidator = body('sourcePublicKey')
  .isString()
  .trim()
  .matches(/^G[A-Z2-7]{55}$/)
  .withMessage('sourcePublicKey must be a valid Stellar public key (G…)');

const signedTxXdrValidator = body('signedTxXdr')
  .isString()
  .trim()
  .notEmpty()
  .withMessage('signedTxXdr is required — sign the XDR client-side and submit it here');

// ── Deprecation guard: reject any request that still sends sourceSecret ──────

function rejectSourceSecret(req, res, next) {
  if (req.body && 'sourceSecret' in req.body) {
    return res.status(400).json({
      error:
        'sourceSecret is no longer accepted. ' +
        'Use POST /invoke/build to get an unsigned XDR, sign it client-side, ' +
        'then submit via POST /invoke with signedTxXdr.',
    });
  }
  next();
}

// ── POST /invoke/build ───────────────────────────────────────────────────────
// Returns an unsigned transaction XDR envelope so the caller can sign it
// locally and submit via POST /invoke.

/**
 * @swagger
 * /api/stellar/contract/invoke/build:
 *   post:
 *     summary: Build an unsigned Soroban transaction XDR
 *     description: |
 *       Assembles and simulates a Soroban contract call, returning an unsigned
 *       XDR envelope the client must sign locally before submitting via
 *       POST /invoke.  The server never receives or stores any secret key.
 *     tags: [SorobanContract]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [functionName, sourcePublicKey]
 *             properties:
 *               functionName:
 *                 type: string
 *                 description: Name of the contract function to call
 *                 example: buy_yes
 *               args:
 *                 type: array
 *                 description: Arguments to pass to the contract function
 *                 example: [0, 100000, 1]
 *               sourcePublicKey:
 *                 type: string
 *                 description: Stellar public key (G…) of the account that will sign
 *                 example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *               contractAddress:
 *                 type: string
 *                 description: Contract address (defaults to STELLAR_CONTRACT_ADDRESS env var)
 *     responses:
 *       200:
 *         description: Unsigned XDR ready for client-side signing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unsignedXdr:
 *                   type: string
 *                 networkPassphrase:
 *                   type: string
 *                 fee:
 *                   type: string
 *       400:
 *         description: sourceSecret rejected (deprecated field)
 *       422:
 *         description: Validation error or simulation failure
 *       503:
 *         description: Contract address not configured
 */

router.post(
  '/invoke/build',
  rejectSourceSecret,
  functionNameValidator,
  argsValidator,
  contractAddressValidator,
  sourcePublicKeyValidator,
  validate,
  async (req, res) => {
    const contractAddress =
      req.body.contractAddress || process.env.STELLAR_CONTRACT_ADDRESS;
    if (!contractAddress) {
      return res.status(503).json({ error: 'STELLAR_CONTRACT_ADDRESS is not configured' });
    }

    try {
      const server = getSorobanServer();
      const sourceAccount = await server.getAccount(req.body.sourcePublicKey);
      const contract = new StellarSDK.Contract(contractAddress);
      const operation = contract.call(
        req.body.functionName,
        ...(req.body.args || []).map(scValFromJson),
      );

      const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
        fee: StellarSDK.BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
      })
        .addOperation(operation)
        .setTimeout(60)
        .build();

      // Simulate to get the soroban data / fee estimate, then attach it
      const simResult = await server.simulateTransaction(transaction);
      if (StellarSDK.rpc.Api.isSimulationError(simResult)) {
        return res.status(422).json({
          error: 'Simulation failed — check functionName/args and try again',
          simulationError: simResult.error,
          diagnosticEvents: simResult.events ?? [],
        });
      }

      const assembled = StellarSDK.rpc.assembleTransaction(
        transaction,
        simResult,
      ).build();

      res.json({
        contractAddress,
        functionName: req.body.functionName,
        unsignedXdr: assembled.toXDR(),
        networkPassphrase: getNetworkPassphrase(),
        fee: assembled.fee,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to build Soroban transaction',
        ...extractSorobanError(error),
      });
    }
  },
);

// ── POST /invoke/simulate ────────────────────────────────────────────────────
// Dry-runs a contract call and returns cost/result without submitting.

/**
 * @swagger
 * /api/stellar/contract/invoke/simulate:
 *   post:
 *     summary: Simulate a Soroban contract call (dry-run, no submission)
 *     description: |
 *       Calls simulateTransaction on the RPC and returns cost estimates, the
 *       return value, and any diagnostic events without broadcasting to the network.
 *     tags: [SorobanContract]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [functionName, sourcePublicKey]
 *             properties:
 *               functionName:
 *                 type: string
 *                 example: get_market
 *               args:
 *                 type: array
 *                 example: [0]
 *               sourcePublicKey:
 *                 type: string
 *                 example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *               contractAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Simulation result with cost and return value
 *       400:
 *         description: sourceSecret rejected (deprecated field)
 *       422:
 *         description: Simulation failed with diagnostics
 *       503:
 *         description: Contract address not configured
 */

router.post(
  '/invoke/simulate',
  rejectSourceSecret,
  functionNameValidator,
  argsValidator,
  contractAddressValidator,
  sourcePublicKeyValidator,
  validate,
  async (req, res) => {
    const contractAddress =
      req.body.contractAddress || process.env.STELLAR_CONTRACT_ADDRESS;
    if (!contractAddress) {
      return res.status(503).json({ error: 'STELLAR_CONTRACT_ADDRESS is not configured' });
    }

    try {
      const server = getSorobanServer();
      const sourceAccount = await server.getAccount(req.body.sourcePublicKey);
      const contract = new StellarSDK.Contract(contractAddress);
      const operation = contract.call(
        req.body.functionName,
        ...(req.body.args || []).map(scValFromJson),
      );

      const transaction = new StellarSDK.TransactionBuilder(sourceAccount, {
        fee: StellarSDK.BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
      })
        .addOperation(operation)
        .setTimeout(60)
        .build();

      const simResult = await server.simulateTransaction(transaction);

      if (StellarSDK.rpc.Api.isSimulationError(simResult)) {
        return res.status(422).json({
          error: 'Simulation failed',
          simulationError: simResult.error,
          diagnosticEvents: simResult.events ?? [],
        });
      }

      res.json({
        contractAddress,
        functionName: req.body.functionName,
        result: simResult.result ?? null,
        cost: simResult.cost ?? null,
        footprint: simResult.footprint ?? null,
        diagnosticEvents: simResult.events ?? [],
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to simulate Soroban contract call',
        ...extractSorobanError(error),
      });
    }
  },
);

// ── POST /invoke ─────────────────────────────────────────────────────────────
// Submits a pre-signed transaction XDR.  Signing must happen client-side.

/**
 * @swagger
 * /api/stellar/contract/invoke:
 *   post:
 *     summary: Submit a signed Soroban transaction
 *     description: |
 *       Accepts a client-signed transaction XDR and broadcasts it via
 *       sendTransaction.  The server never handles a secret key; signing must
 *       happen client-side using the unsigned XDR from POST /invoke/build.
 *     tags: [SorobanContract]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signedTxXdr]
 *             properties:
 *               signedTxXdr:
 *                 type: string
 *                 description: Base64-encoded signed transaction XDR
 *               contractAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction submitted; returns hash and status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hash:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         description: sourceSecret rejected (deprecated field)
 *       422:
 *         description: Transaction failed on submission (with Soroban diagnostics)
 *       503:
 *         description: Contract address not configured
 */

router.post(
  '/invoke',
  rejectSourceSecret,
  signedTxXdrValidator,
  contractAddressValidator,
  validate,
  async (req, res) => {
    const contractAddress =
      req.body.contractAddress || process.env.STELLAR_CONTRACT_ADDRESS;
    if (!contractAddress) {
      return res.status(503).json({ error: 'STELLAR_CONTRACT_ADDRESS is not configured' });
    }

    try {
      const server = getSorobanServer();

      // Deserialise the caller-supplied signed XDR
      const transaction = StellarSDK.TransactionBuilder.fromXDR(
        req.body.signedTxXdr,
        getNetworkPassphrase(),
      );

      const submitted = await server.sendTransaction(transaction);

      if (submitted.status === 'ERROR') {
        return res.status(422).json({
          error: 'Soroban transaction failed on submission',
          status: submitted.status,
          errorResultXdr: submitted.errorResultXdr ?? null,
          diagnosticEvents: submitted.diagnosticEvents ?? [],
        });
      }

      res.json({
        contractAddress,
        hash: submitted.hash,
        status: submitted.status,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to submit Soroban transaction',
        ...extractSorobanError(error),
      });
    }
  },
);

export default router;
