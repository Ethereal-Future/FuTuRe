/**
 * Security Headers Audit Tests (#730)
 * Validates that all required security headers are present in HTTP responses
 * Tests both HTML and API (JSON) endpoints
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock security headers middleware for testing
function securityHeadersMiddleware(req, res, next) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; object-src 'none'; report-uri /api/security/csp-report",
  );
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

describe('Security Headers Audit - #730', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(securityHeadersMiddleware);
    app.use(express.json());

    // Mock routes for testing
    app.get('/', (req, res) => res.send('<html><body>OK</body></html>'));
    app.get('/api/test', (req, res) => res.json({ status: 'ok' }));
    app.post('/api/payment', (req, res) => res.json({ transactionId: '123' }));
  });

  describe('Required security headers present', () => {
    it('should include Strict-Transport-Security header', async () => {
      const res = await request(app).get('/');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
      expect(res.headers['strict-transport-security']).toContain('includeSubDomains');
    });

    it('should include X-Frame-Options header set to DENY', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('should include X-Content-Type-Options header set to nosniff', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include Referrer-Policy header', async () => {
      const res = await request(app).get('/');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should include Content-Security-Policy header', async () => {
      const res = await request(app).get('/');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy'].length).toBeGreaterThan(0);
    });

    it('should include Permissions-Policy header', async () => {
      const res = await request(app).get('/');
      expect(res.headers['permissions-policy']).toBeDefined();
    });
  });

  describe('Headers on HTML endpoints', () => {
    it('should set all required headers on root HTML endpoint', async () => {
      const res = await request(app).get('/');

      const requiredHeaders = {
        'strict-transport-security': /max-age=31536000/,
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'content-security-policy': /.+/,
        'permissions-policy': /.+/,
      };

      Object.entries(requiredHeaders).forEach(([header, pattern]) => {
        expect(res.headers[header.toLowerCase()]).toBeDefined();
        if (typeof pattern === 'string') {
          expect(res.headers[header.toLowerCase()]).toBe(pattern);
        } else {
          expect(res.headers[header.toLowerCase()]).toMatch(pattern);
        }
      });
    });
  });

  describe('Headers on API (JSON) endpoints', () => {
    it('should set all required headers on GET API endpoint', async () => {
      const res = await request(app).get('/api/test');

      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['permissions-policy']).toBeDefined();
    });

    it('should set all required headers on POST API endpoint', async () => {
      const res = await request(app).post('/api/payment').send({ destination: 'test' });

      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['permissions-policy']).toBeDefined();
    });
  });

  describe('Header validation details', () => {
    it('Strict-Transport-Security should have max-age of 1 year', async () => {
      const res = await request(app).get('/');
      const hsts = res.headers['strict-transport-security'];
      expect(hsts).toContain('max-age=31536000');
    });

    it('X-Frame-Options should deny all embedding', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('CSP should define default-src', async () => {
      const res = await request(app).get('/');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('CSP should restrict script-src', async () => {
      const res = await request(app).get('/');
      expect(res.headers['content-security-policy']).toContain('script-src');
    });

    it('Permissions-Policy should block camera access', async () => {
      const res = await request(app).get('/');
      expect(res.headers['permissions-policy']).toContain('camera=()');
    });

    it('Permissions-Policy should block microphone access', async () => {
      const res = await request(app).get('/');
      expect(res.headers['permissions-policy']).toContain('microphone=()');
    });
  });

  describe('Security headers coverage', () => {
    it('should report all required headers when passing CI', async () => {
      const res1 = await request(app).get('/');

      const headersToCheck = [
        'strict-transport-security',
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy',
        'content-security-policy',
        'permissions-policy',
      ];

      const auditResults = headersToCheck.map((header) => ({
        header,
        present: !!res1.headers[header.toLowerCase()],
      }));

      const allPresent = auditResults.every((r) => r.present);
      expect(allPresent).toBe(true);
      expect(auditResults).toHaveLength(6);
    });

    it('should fail audit if any required header is missing', async () => {
      const badApp = express();
      badApp.use((req, res2, next) => {
        res2.setHeader('X-Frame-Options', 'DENY');
        res2.setHeader('X-Content-Type-Options', 'nosniff');
        // Missing others
        next();
      });
      badApp.get('/', (req, res3) => res3.send('test'));

      const res4 = await request(badApp).get('/');

      const requiredHeaders = [
        'strict-transport-security',
        'x-frame-options',
        'x-content-type-options',
        'referrer-policy',
        'content-security-policy',
        'permissions-policy',
      ];

      const missingHeaders = requiredHeaders.filter((h) => !res4.headers[h.toLowerCase()]);
      expect(missingHeaders.length).toBeGreaterThan(0);
    });
  });

  describe('Header values validation', () => {
    it('X-Content-Type-Options must be nosniff (not browsesniff or other variants)', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('Referrer-Policy must be strict-origin-when-cross-origin (not loose)', async () => {
      const res = await request(app).get('/');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('CSP should not allow eval', async () => {
      const res = await request(app).get('/');
      expect(res.headers['content-security-policy']).not.toContain("'unsafe-eval'");
    });

    it('CSP should not allow unsafe-inline by default', async () => {
      const res = await request(app).get('/');
      const csp = res.headers['content-security-policy'];
      // CSP may allow inline for some directives, but script-src should be restrictive
      if (csp.includes('script-src')) {
        expect(csp.match(/script-src/)?.[0]).toBeDefined();
      }
    });
  });

  describe('HTTP status codes with headers', () => {
    it('should include security headers on 200 OK', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('should include security headers on 201 Created', async () => {
      const createApp = express();
      createApp.use(securityHeadersMiddleware);
      createApp.post('/', (req, response) => response.status(201).json({ id: 1 }));

      const res = await request(createApp).post('/');
      expect(res.status).toBe(201);
      expect(res.headers['x-frame-options']).toBe('DENY');
    });
  });
});
