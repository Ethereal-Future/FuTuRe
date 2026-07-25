import { describe, it, expect } from 'vitest';
import { securityHeaders } from '../src/middleware/securityHeaders.js';

describe('Security Headers Middleware', () => {
  it('should set Content-Security-Policy header', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['Content-Security-Policy']).toBeDefined();
  });

  it('should include default-src self in CSP', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'");
  });

  it('should restrict script-src to self in CSP', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['Content-Security-Policy']).toContain("script-src 'self'");
  });

  it('should allow connect-src to Horizon URLs', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    const csp = res.headers['Content-Security-Policy'];
    expect(csp).toContain('https://horizon-testnet.stellar.org');
    expect(csp).toContain('https://horizon.stellar.org');
  });

  it('should block object-src in CSP', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['Content-Security-Policy']).toContain("object-src 'none'");
  });

  it('should include report-uri directive', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['Content-Security-Policy']).toContain('report-uri /api/security/csp-report');
  });

  it('should set X-Content-Type-Options header', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('should set X-Frame-Options to DENY', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    const next = () => {};

    securityHeaders(req, res, next);

    expect(res.headers['X-Frame-Options']).toBe('DENY');
  });

  it('should call next middleware', () => {
    const req = {};
    const res = {
      headers: {},
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    securityHeaders(req, res, next);

    expect(nextCalled).toBe(true);
  });
});
