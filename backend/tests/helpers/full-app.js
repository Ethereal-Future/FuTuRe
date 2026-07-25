import express from 'express';
import cors from 'cors';
import stellarRoutes from '../../src/routes/stellar.js';
import authRoutes from '../../src/routes/auth.js';
import transactionRoutes from '../../src/routes/transactions.js';
import streamingRoutes from '../../src/routes/streaming.js';

// Setup environment for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.STELLAR_NETWORK = 'testnet';
process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';

const app = express();
app.use(cors());
app.use(express.json());

// Mount routes
app.use('/api/stellar', stellarRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/streaming', streamingRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', network: 'testnet' }));

// Global error handler for tests
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message });
});

export default app;
