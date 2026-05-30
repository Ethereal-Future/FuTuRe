import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Issue #440: Graceful shutdown with signal handling', () => {
  it('should exit cleanly on SIGTERM', async () => {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, '../src/server.js');
      const proc = spawn('node', [serverPath], {
        env: {
          ...process.env,
          PORT: '3999',
          STREAM_SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
          DATABASE_URL: 'postgresql://user:pass@localhost/db',
          STELLAR_NETWORK: 'testnet',
          JWT_SECRET: 'test-secret',
          NODE_ENV: 'test',
        },
        stdio: 'pipe',
      });

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      // Give server time to start, then send SIGTERM
      setTimeout(() => {
        proc.kill('SIGTERM');
      }, 500);

      proc.on('exit', (code) => {
        if (code === 0) {
          expect(output).toContain('server.shutdown.start');
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Graceful shutdown timeout'));
      }, 5000);
    });
  });

  it('should clear intervals on shutdown', async () => {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(__dirname, '../src/server.js');
      const proc = spawn('node', [serverPath], {
        env: {
          ...process.env,
          PORT: '3998',
          STREAM_SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
          DATABASE_URL: 'postgresql://user:pass@localhost/db',
          STELLAR_NETWORK: 'testnet',
          JWT_SECRET: 'test-secret',
          NODE_ENV: 'test',
        },
        stdio: 'pipe',
      });

      let output = '';
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      // Give server time to start, then send SIGINT
      setTimeout(() => {
        proc.kill('SIGINT');
      }, 500);

      proc.on('exit', (code) => {
        if (code === 0) {
          expect(output).toContain('server.shutdown.intervalsCleared');
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Graceful shutdown timeout'));
      }, 5000);
    });
  });
});
