import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import stellarRoutes from './routes/stellar.js';
import { initWebSocket } from './services/websocket.js';
import eventsRoutes from './routes/events.js';
import securityRoutes from './routes/security.js';
import loadTestingRoutes from './routes/loadTesting.js';
import chaosRoutes from './routes/chaos.js';
import { eventMonitor } from './eventSourcing/index.js';
import { auditLogger } from './security/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Initialize event sourcing
await eventMonitor.initialize();
await auditLogger.initialize();

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api/stellar', stellarRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/load-testing', loadTestingRoutes);
app.use('/api/chaos', chaosRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: process.env.STELLAR_NETWORK });
});

const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Network: ${process.env.STELLAR_NETWORK}`);
});
