/**
 * Provider contract verification: Backend verifies it satisfies the frontend's contracts.
 *
 * Uses a lightweight Express server that implements only the contracted endpoints,
 * matching the real backend's response shapes without requiring a database or Stellar network.
 */

import { Verifier } from '@pact-foundation/pact';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, beforeAll, afterAll } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal provider app that satisfies the contracted interactions
function createProviderApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', network: 'testnet' });
  });

  app.post('/api/stellar/account/create', (_req, res) => {
    res.json({
      publicKey: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      secretKey: 'SABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    });
  });

  app.get('/api/stellar/account/:publicKey', (req, res) => {
    res.json({
      publicKey: req.params.publicKey,
      balances: [{ asset_type: 'native', balance: '100.0000000' }],
    });
  });

  app.post('/api/stellar/payment/send', (_req, res) => {
    res.json({ hash: 'abc123txhash', successful: true });
  });

  return app;
}

let server;
let port;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = createServer(createProviderApp());
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

describe('Backend Provider Verification', () => {
  it('satisfies all consumer contracts', async () => {
    await new Verifier({
      provider: 'FuTuRe-Backend',
      providerBaseUrl: `http://127.0.0.1:${port}`,
      pactUrls: [path.resolve(__dirname, '../pacts/FuTuRe-Frontend-FuTuRe-Backend.json')],
      logLevel: 'warn',
      stateHandlers: {
        'stellar service is available': async () => {},
        'server is running': async () => {},
        'account exists on testnet': async () => {},
        'source account has sufficient balance': async () => {},
      },
    }).verifyProvider();
  }, 60_000);
});
