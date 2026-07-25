/**
 * Minimal HTTP server for provider contract verification.
 * Started as a subprocess by the provider test.
 */
import http from 'http';
import app from '../tests/helpers/app.js';

const port = process.env.CONTRACT_TEST_PORT || 3099;
http.createServer(app).listen(port, '127.0.0.1', () => {
  process.stdout.write(`ready:${port}\n`);
});
