/**
 * Minimal Express app fixture for integration tests.
 * Mounts only the Stellar routes — no WebSocket, no event sourcing startup.
 */

import express from 'express';
import cors from 'cors';
import stellarRoutes from '../../src/routes/stellar.js';

// Stub out eventMonitor so importing stellar service doesn't blow up
process.env.NODE_ENV = 'test';
process.env.STELLAR_NETWORK = 'testnet';
process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/stellar', stellarRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', network: 'testnet' }));

export default app;
