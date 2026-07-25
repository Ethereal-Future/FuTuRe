/**
 * Security Vulnerability Tests
 * 
 * Tests for common security vulnerabilities including XSS, CSRF, injection, etc.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

describe('Security Vulnerability Tests', () => {
  let authToken;

  beforeAll(async () => {
    // Get auth token for authenticated tests
    try {
      const response = await axios.post(`${BASE_URL}/api/auth/login`, {
        email: 'test@example.com',
        password: 'password123',
      });
      authToken = response.data.token;
    } catch (error) {
      console.warn('Could not get auth token:', error.message);
    }
  });

  describe('XSS (Cross-Site Scripting) Tests', () => {
    it('should prevent XSS in account creation', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      try {
        const response = await axios.post(`${BASE_URL}/api/stellar/account/create`, {
          name: xssPayload,
          email: 'test@example.com',
        });
        
        // Check that the response doesn't contain the unescaped script
        expect(JSON.stringify(response.data)).not.toContain('<script>');
      } catch (error) {
        // Expected to fail validation
        expect(error.response.status).toBe(422);
      }
    });

    it('should prevent XSS in payment destination', async () => {
      const xssPayload = '<img src=x onerror=alert("XSS")>';
      
      try {
        const response = await axios.post(`${BASE_URL}/api/stellar/payment/send`, {
          sourceSecret: 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
          destination: xssPayload,
          amount: '10',
        });
        
        expect(JSON.stringify(response.data)).not.toContain('onerror');
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });

    it('should prevent XSS in search queries', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      try {
        const response = await axios.get(`${BASE_URL}/api/stellar/transactions/${xssPayload}`);
        
        expect(JSON.stringify(response.data)).not.toContain('<script>');
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });

    it('should prevent XSS in error messages', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      try {
        const response = await axios.get(`${BASE_URL}/api/stellar/account/${xssPayload}`);
        
        // Error messages should be escaped
        expect(JSON.stringify(response.data)).not.toContain('<script>');
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });
  });

  describe('CSRF (Cross-Site Request Forgery) Tests', () => {
    it('should require CSRF token for state-changing operations', async () => {
      try {
        const response = await axios.post(`${BASE_URL}/api/stellar/payment/send`, {
          sourceSecret: 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
          destination: 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6',
          amount: '10',
        }, {
          headers: {
            'Origin': 'https://malicious-site.com',
          },
        });
        
        // Should reject request from different origin
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect([400, 403]).toContain(error.response.status);
      }
    });

    it('should validate Referer header', async () => {
      try {
        const response = await axios.post(`${BASE_URL}/api/stellar/payment/send`, {
          sourceSecret: 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
          destination: 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6',
          amount: '10',
        }, {
          headers: {
            'Referer': 'https://malicious-site.com',
          },
        });
        
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect([400, 403]).toContain(error.response.status);
      }
    });
  });

  describe('Injection Tests', () => {
    it('should prevent SQL injection in account lookup', async () => {
      const sqlInjection = "'; DROP TABLE users; --";
      
      try {
        const response = await axios.get(`${BASE_URL}/api/stellar/account/${sqlInjection}`);
        
        // Should not execute SQL
        expect(response.status).toBe(422);
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });

    it('should prevent NoSQL injection in login', async () => {
      const nosqlInjection = { $gt: '' };
      
      try {
        const response = await axios.post(`${BASE_URL}/api/auth/login`, {
          email: nosqlInjection,
          password: 'password123',
        });
        
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect([400, 401]).toContain(error.response.status);
      }
    });

    it('should prevent command injection in file operations', async () => {
      const commandInjection = '; rm -rf /';
      
      try {
        const response = await axios.get(`${BASE_URL}/api/files/${commandInjection}`);
        
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect([400, 404]).toContain(error.response.status);
      }
    });

    it('should prevent LDAP injection', async () => {
      const ldapInjection = '*)(&(|';
      
      try {
        const response = await axios.post(`${BASE_URL}/api/auth/login`, {
          email: ldapInjection,
          password: 'password123',
        });
        
        expect(response.status).not.toBe(200);
      } catch (error) {
        expect([400, 401]).toContain(error.response.status);
      }
    });
  });

  describe('Authentication and Authorization Tests', () => {
    it('should reject requests without authentication', async () => {
      try {
        const response = await axios.get(`${BASE_URL}/api/accounts`);
        
        expect(response.status).toBe(401);
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });

    it('should reject invalid authentication tokens', async () => {
      try {
        const response = await axios.get(`${BASE_URL}/api/accounts`, {
          headers: {
            'Authorization': 'Bearer invalid-token',
          },
        });
        
        expect(response.status).toBe(401);
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });

    it('should reject expired authentication tokens', async () => {
      try {
        const response = await axios.get(`${BASE_URL}/api/accounts`, {
          headers: {
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
          },
        });
        
        expect(response.status).toBe(401);
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });

    it('should prevent privilege escalation', async () => {
      try {
        // Try to access admin endpoint with regular user token
        const response = await axios.get(`${BASE_URL}/api/admin/users`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });
        
        expect(response.status).toBe(403);
      } catch (error) {
        expect(error.response.status).toBe(403);
      }
    });

    it('should enforce rate limiting', async () => {
      const requests = [];
      
      // Make 100 rapid requests
      for (let i = 0; i < 100; i++) {
        requests.push(
          axios.post(`${BASE_URL}/api/auth/login`, {
            email: 'test@example.com',
            password: 'password123',
          }).catch(error => error.response)
        );
      }
      
      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Input Validation Tests', () => {
    it('should validate email format', async () => {
      try {
        const response = await axios.post(`${BASE_URL}/api/auth/register`, {
          email: 'invalid-email',
          password: 'password123',
        });
        
        expect(response.status).toBe(422);
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });

    it('should validate Stellar public key format', async () => {
      try {
        const response = await axios.get(`${BASE_URL}/api/stellar/account/invalid-key`);
        
        expect(response.status).toBe(422);
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });

    it('should validate payment amount', async () => {
      try {
        const response = await axios.post(`${BASE_URL}/api/stellar/payment/send`, {
          sourceSecret: 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
          destination: 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6',
          amount: '-10',
        });
        
        expect(response.status).toBe(422);
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });

    it('should validate asset code format', async () => {
      try {
        const response = await axios.post(`${BASE_URL}/api/stellar/payment/send`, {
          sourceSecret: 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
          destination: 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6',
          amount: '10',
          assetCode: 'TOOLONGASSETCODE',
        });
        
        expect(response.status).toBe(422);
      } catch (error) {
        expect(error.response.status).toBe(422);
      }
    });
  });

  describe('Data Exposure Tests', () => {
    it('should not expose sensitive data in error messages', async () => {
      try {
        const response = await axios.post(`${BASE_URL}/api/auth/login`, {
          email: 'nonexistent@example.com',
          password: 'password123',
        });
        
        // Should not reveal if email exists
        expect(response.data.error).not.toContain('email');
        expect(response.data.error).not.toContain('user');
      } catch (error) {
        expect(error.response.data.error).not.toContain('email');
        expect(error.response.data.error).not.toContain('user');
      }
    });

    it('should not expose stack traces in production', async () => {
      process.env.NODE_ENV = 'production';
      
      try {
        const response = await axios.get(`${BASE_URL}/api/stellar/account/invalid-key`);
        
        expect(response.data).not.toHaveProperty('stack');
        expect(response.data).not.toHaveProperty('trace');
      } catch (error) {
        expect(error.response.data).not.toHaveProperty('stack');
        expect(error.response.data).not.toHaveProperty('trace');
      } finally {
        process.env.NODE_ENV = 'test';
      }
    });

    it('should not expose internal IDs in responses', async () => {
      try {
        const response = await axios.get(`${BASE_URL}/api/accounts`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });
        
        const responseStr = JSON.stringify(response.data);
        expect(responseStr).not.toContain('_id');
        expect(responseStr).not.toContain('internalId');
      } catch (error) {
        const responseStr = JSON.stringify(error.response.data);
        expect(responseStr).not.toContain('_id');
        expect(responseStr).not.toContain('internalId');
      }
    });
  });

  describe('Security Headers Tests', () => {
    it('should include X-Content-Type-Options header', async () => {
      const response = await axios.get(`${BASE_URL}/`);
      
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should include X-Frame-Options header', async () => {
      const response = await axios.get(`${BASE_URL}/`);
      
      expect(response.headers['x-frame-options']).toBe('DENY');
    });

    it('should include X-XSS-Protection header', async () => {
      const response = await axios.get(`${BASE_URL}/`);
      
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    it('should include Content-Security-Policy header', async () => {
      const response = await axios.get(`${BASE_URL}/`);
      
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    it('should include Strict-Transport-Security header', async () => {
      const response = await axios.get(`${BASE_URL}/`);
      
      expect(response.headers['strict-transport-security']).toBeDefined();
    });

    it('should include Referrer-Policy header', async () => {
      const response = await axios.get(`${BASE_URL}/`);
      
      expect(response.headers['referrer-policy']).toBeDefined();
    });
  });
});
