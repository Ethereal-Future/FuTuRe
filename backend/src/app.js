import express from 'express';
import complianceRouter from './routes/compliance.js';

const app = express();

app.use(express.json());

// Register compliance routes
app.use('/api/compliance', complianceRouter);

export default app;