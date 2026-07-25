import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..');

describe('Server Startup', () => {
  it('should start without errors and load environment variables', async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        process.kill(serverProcess.pid);
        reject(new Error('Server startup timeout'));
      }, 10000);

      const serverProcess = spawn('node', ['src/server.js'], {
        cwd: backendDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: '3002',
          STELLAR_NETWORK: 'testnet',
          HORIZON_URL: 'https://horizon-testnet.stellar.org',
        },
      });

      let output = '';
      let errorOutput = '';

      serverProcess.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('server.started')) {
          clearTimeout(timeout);
          serverProcess.kill();
          resolve();
        }
      });

      serverProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        if (errorOutput.includes('dotenv is not defined') || errorOutput.includes('ReferenceError')) {
          clearTimeout(timeout);
          serverProcess.kill();
          reject(new Error(`Server startup failed: ${errorOutput}`));
        }
      });

      serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      serverProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`Server exited with code ${code}: ${errorOutput}`));
        }
      });
    });
  }, 15000);
});
