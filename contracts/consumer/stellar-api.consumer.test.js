/**
 * Consumer contract tests: Frontend → Backend (Stellar API)
 * Defines what the frontend expects from the backend API.
 * Generates pact files in contracts/pacts/
 */

import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const { like, eachLike, string } = MatchersV3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const provider = new PactV3({
  consumer: 'FuTuRe-Frontend',
  provider: 'FuTuRe-Backend',
  dir: path.resolve(__dirname, '../pacts'),
  logLevel: 'warn',
});

async function apiCall(baseUrl, method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

describe('Frontend → Backend Contract', () => {
  it('POST /api/stellar/account/create returns a new keypair', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'stellar service is available' }],
        uponReceiving: 'a request to create a new account',
        withRequest: { method: 'POST', path: '/api/stellar/account/create' },
        willRespondWith: {
          status: 200,
          body: {
            publicKey: string('GABC123'),
            secretKey: string('SABC123'),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const result = await apiCall(mockServer.url, 'POST', '/api/stellar/account/create');
        expect(result).toHaveProperty('publicKey');
        expect(result).toHaveProperty('secretKey');
      });
  });

  it('GET /api/stellar/account/:publicKey returns account balances', async () => {
    const testKey = 'GABC1234567890ABCDEF';
    await provider
      .addInteraction({
        states: [{ description: 'account exists on testnet' }],
        uponReceiving: 'a request to get account balance',
        withRequest: { method: 'GET', path: `/api/stellar/account/${testKey}` },
        willRespondWith: {
          status: 200,
          body: {
            balances: eachLike({
              asset_type: string('native'),
              balance: string('100.0000000'),
            }),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const result = await apiCall(mockServer.url, 'GET', `/api/stellar/account/${testKey}`);
        expect(result).toHaveProperty('balances');
        expect(Array.isArray(result.balances)).toBe(true);
      });
  });

  it('POST /api/stellar/payment/send returns a transaction hash', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'source account has sufficient balance' }],
        uponReceiving: 'a request to send a payment',
        withRequest: {
          method: 'POST',
          path: '/api/stellar/payment/send',
          body: {
            sourceSecret: string('SABC123'),
            destination: string('GDEST123'),
            amount: string('10'),
          },
        },
        willRespondWith: {
          status: 200,
          body: {
            hash: string('abc123txhash'),
            successful: MatchersV3.boolean(true),
          },
        },
      })
      .executeTest(async (mockServer) => {
        const result = await apiCall(mockServer.url, 'POST', '/api/stellar/payment/send', {
          sourceSecret: 'SABC123',
          destination: 'GDEST123',
          amount: '10',
        });
        expect(result).toHaveProperty('hash');
        expect(result).toHaveProperty('successful');
      });
  });

  it('GET /health returns ok status', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'server is running' }],
        uponReceiving: 'a health check request',
        withRequest: { method: 'GET', path: '/health' },
        willRespondWith: {
          status: 200,
          body: { status: string('ok') },
        },
      })
      .executeTest(async (mockServer) => {
        const result = await apiCall(mockServer.url, 'GET', '/health');
        expect(result.status).toBe('ok');
      });
  });
});
