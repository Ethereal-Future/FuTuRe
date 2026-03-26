import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import stellarRoutes from './routes/stellar.js';
import multiSigRoutes from './routes/multiSig.js';
import { initWebSocket } from './services/websocket.js';
import eventsRoutes from './routes/events.js';
import securityRoutes from './routes/security.js';
import loadTestingRoutes from './routes/loadTesting.js';
import chaosRoutes from './routes/chaos.js';
import mobileRoutes from './routes/mobile.js';
import { eventMonitor } from './eventSourcing/index.js';
import { auditLogger } from './security/index.js';
import { getConfig } from './config/env.js';
import { createRateLimiter } from './middleware/rateLimiter.js';

dotenv.config();

const app = express();
const PORT = getConfig().server.port;

app.use(cors({
  origin: (origin, cb) => {
    const allowedOrigins = getConfig().cors.allowedOrigins;
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Rate limiting
app.use(createRateLimiter());

// Initialize event sourcing
await eventMonitor.initialize();
await auditLogger.initialize();

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api/stellar', stellarRoutes);
app.use('/api/multisig', multiSigRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/load-testing', loadTestingRoutes);
app.use('/api/chaos', chaosRoutes);
app.use('/api/mobile', mobileRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: getConfig().stellar.network });
});

const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(PORT, () => {
  const { stellar, meta } = getConfig();
  console.log(`Server running on port ${PORT}`);
  console.log(`Network: ${stellar.network}`);
  if (meta.loadedEnvFiles.length > 0) {
    console.log(`Env files: ${meta.loadedEnvFiles.map(p => p.split('/').pop()).join(', ')}`);
  }
});
