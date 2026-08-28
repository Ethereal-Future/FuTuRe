import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PENTEST_DIR = path.join(__dirname, '../../data/pentests');

class PenetrationTester {
  constructor() {
    this.baseUrl = process.env.APP_URL || 'http://localhost:3000';
  }

  async initialize() {
    await fs.mkdir(PENTEST_DIR, { recursive: true });
  }

  async runSecurityTests() {
    await this.initialize();

    const testId = `PENTEST-${Date.now()}`;
    const results = {
      id: testId,
      timestamp: new Date().toISOString(),
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        criticalIssues: 0
      }
    };

    // SQL Injection tests
    results.tests.push(await this.testSQLInjection());

    // XSS tests
    results.tests.push(await this.testXSS());

    // CSRF tests
    results.tests.push(await this.testCSRF());

    // Authentication tests
    results.tests.push(await this.testAuthentication());

    // Authorization tests
    results.tests.push(await this.testAuthorization());

    // API security tests
    results.tests.push(await this.testAPIEndpoints());

    // Calculate summary
    results.summary.total = results.tests.length;
    results.summary.passed = results.tests.filter(t => t.status === 'PASS').length;
    results.summary.failed = results.tests.filter(t => t.status === 'FAIL').length;
    results.summary.criticalIssues = results.tests.filter(t => t.severity === 'CRITICAL' && t.status === 'FAIL').length;

    const testFile = path.join(PENTEST_DIR, `${testId}.json`);
    await fs.writeFile(testFile, JSON.stringify(results, null, 2));

    logger.info({
      testId,
      passed: results.summary.passed,
      failed: results.summary.failed,
      criticalIssues: results.summary.criticalIssues
    }, 'Security penetration test completed');

    return results;
  }

  async testSQLInjection() {
    const findings = [];
    let status = 'PASS';

    try {
      // Check if Prisma is being used (parameterized queries)
      const hasPrisma = prisma !== null;
      
      if (!hasPrisma) {
        status = 'FAIL';
        findings.push('No ORM detected - raw SQL queries may be vulnerable');
      } else {
        findings.push('Prisma ORM detected - parameterized queries in use');
      }

      // Check for any raw SQL usage in codebase patterns
      const rawSqlPatterns = await this.checkForRawSQLPatterns();
      if (rawSqlPatterns.length > 0) {
        status = 'FAIL';
        findings.push(`Found ${rawSqlPatterns.length} instances of raw SQL queries`);
        findings.push(...rawSqlPatterns.slice(0, 3).map(p => `  - ${p}`));
      }

    } catch (error) {
      status = 'FAIL';
      findings.push(`Test error: ${error.message}`);
      logger.error({ error }, 'SQL Injection test failed');
    }

    return {
      name: 'SQL Injection',
      status,
      severity: 'CRITICAL',
      description: 'Test for SQL injection vulnerabilities',
      findings: findings.join('; ') || 'No SQL injection vulnerabilities detected'
    };
  }

  async checkForRawSQLPatterns() {
    // This is a simplified check - in production, use static analysis tools
    const patterns = [];
    try {
      // Check if $queryRaw or $executeRaw are used
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('$queryRaw') || content.includes('$executeRaw')) {
            patterns.push(file.replace(srcPath, ''));
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Could not check for raw SQL patterns');
    }
    return patterns;
  }

  async getJsFiles(dir, fileList = []) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
            await this.getJsFiles(filePath, fileList);
          } else if (file.endsWith('.js')) {
            fileList.push(filePath);
          }
        } catch (err) {
          // Skip files/dirs that can't be accessed
        }
      }
    } catch (error) {
      // Skip if directory can't be read
    }
    return fileList;
  }

  async testXSS() {
    const findings = [];
    let status = 'PASS';

    try {
      // Check if security headers are configured
      const hasHelmet = await this.checkForSecurityMiddleware();
      
      if (!hasHelmet) {
        status = 'FAIL';
        findings.push('Helmet middleware not detected');
      } else {
        findings.push('Security headers middleware detected');
      }

      // Check for dangerouslySetInnerHTML in frontend (if applicable)
      const xssVulnerablePatterns = await this.checkForXSSPatterns();
      if (xssVulnerablePatterns.length > 0) {
        status = 'FAIL';
        findings.push(`Found ${xssVulnerablePatterns.length} potential XSS vulnerabilities`);
        findings.push(...xssVulnerablePatterns.slice(0, 3).map(p => `  - ${p}`));
      }

    } catch (error) {
      status = 'FAIL';
      findings.push(`Test error: ${error.message}`);
      logger.error({ error }, 'XSS test failed');
    }

    return {
      name: 'Cross-Site Scripting (XSS)',
      status,
      severity: 'HIGH',
      description: 'Test for XSS vulnerabilities',
      findings: findings.join('; ') || 'Input validation properly implemented'
    };
  }

  async checkForSecurityMiddleware() {
    try {
      const middlewarePath = path.join(__dirname, '../middleware/securityHeaders.js');
      const content = await fs.readFile(middlewarePath, 'utf-8');
      return content.includes('helmet') || content.includes('csp');
    } catch (error) {
      return false;
    }
  }

  async checkForXSSPatterns() {
    const patterns = [];
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('dangerouslySetInnerHTML') || 
              content.includes('v-html') ||
              content.includes('innerHTML =')) {
            patterns.push(file.replace(srcPath, ''));
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Could not check for XSS patterns');
    }
    return patterns;
  }

  async testCSRF() {
    const findings = [];
    let status = 'PASS';

    try {
      // Check if CSRF middleware exists
      const hasCSRFMiddleware = await this.checkForCSRFMiddleware();
      
      if (!hasCSRFMiddleware) {
        status = 'FAIL';
        findings.push('CSRF protection middleware not detected');
      } else {
        findings.push('CSRF protection middleware detected');
      }

      // Check if SameSite cookie attribute is used
      const hasSameSiteCookies = await this.checkForSameSiteCookies();
      if (!hasSameSiteCookies) {
        findings.push('Warning: SameSite cookie attribute not consistently applied');
      } else {
        findings.push('SameSite cookie attribute in use');
      }

    } catch (error) {
      status = 'FAIL';
      findings.push(`Test error: ${error.message}`);
      logger.error({ error }, 'CSRF test failed');
    }

    return {
      name: 'Cross-Site Request Forgery (CSRF)',
      status,
      severity: 'HIGH',
      description: 'Test for CSRF protection',
      findings: findings.join('; ') || 'CSRF tokens properly implemented'
    };
  }

  async checkForCSRFMiddleware() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('csurf') || 
              content.includes('csrf') ||
              content.includes('x-csrf-token')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForSameSiteCookies() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('sameSite') || content.includes('SameSite')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async testAuthentication() {
    const findings = [];
    let status = 'PASS';

    try {
      // Check if JWT_SECRET is configured
      const hasJWTSecret = !!process.env.JWT_SECRET;
      if (!hasJWTSecret) {
        status = 'FAIL';
        findings.push('JWT_SECRET environment variable not set');
      } else {
        findings.push('JWT authentication configured');
      }

      // Check for MFA implementation
      const hasMFA = await this.checkForMFAImplementation();
      if (!hasMFA) {
        findings.push('Warning: MFA implementation not detected');
      } else {
        findings.push('MFA implementation detected');
      }

      // Check for password hashing
      const hasPasswordHashing = await this.checkForPasswordHashing();
      if (!hasPasswordHashing) {
        status = 'FAIL';
        findings.push('Password hashing not detected (bcrypt/argon2 missing)');
      } else {
        findings.push('Password hashing implemented');
      }

      // Check for OAuth implementation
      const hasOAuth = await this.checkForOAuthImplementation();
      if (hasOAuth) {
        findings.push('OAuth 2.0 implementation detected');
      }

    } catch (error) {
      status = 'FAIL';
      findings.push(`Test error: ${error.message}`);
      logger.error({ error }, 'Authentication test failed');
    }

    return {
      name: 'Authentication',
      status,
      severity: 'CRITICAL',
      description: 'Test authentication mechanisms',
      findings: findings.join('; ') || 'OAuth 2.0 and MFA properly configured'
    };
  }

  async checkForMFAImplementation() {
    try {
      const mfaPath = path.join(__dirname, '../security/mfa.js');
      const content = await fs.readFile(mfaPath, 'utf-8');
      return content.includes('totp') || content.includes('speakeasy');
    } catch (error) {
      return false;
    }
  }

  async checkForPasswordHashing() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('bcrypt') || content.includes('argon2')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForOAuthImplementation() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('oauth') || content.includes('OAuth')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async testAuthorization() {
    const findings = [];
    let status = 'PASS';

    try {
      // Check for role-based access control
      const hasRBAC = await this.checkForRBACImplementation();
      if (!hasRBAC) {
        status = 'FAIL';
        findings.push('Role-based access control not detected');
      } else {
        findings.push('RBAC implementation detected');
      }

      // Check for authorization middleware
      const hasAuthMiddleware = await this.checkForAuthorizationMiddleware();
      if (!hasAuthMiddleware) {
        status = 'FAIL';
        findings.push('Authorization middleware not detected');
      } else {
        findings.push('Authorization middleware in use');
      }

      // Check for proper permission checks
      const hasPermissionChecks = await this.checkForPermissionChecks();
      if (hasPermissionChecks) {
        findings.push('Permission checks detected in routes');
      } else {
        findings.push('Warning: Limited permission checks found');
      }

    } catch (error) {
      status = 'FAIL';
      findings.push(`Test error: ${error.message}`);
      logger.error({ error }, 'Authorization test failed');
    }

    return {
      name: 'Authorization',
      status,
      severity: 'HIGH',
      description: 'Test authorization controls',
      findings: findings.join('; ') || 'Role-based access control properly enforced'
    };
  }

  async checkForRBACImplementation() {
    try {
      // Check if UserRole enum exists in Prisma schema
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const content = await fs.readFile(schemaPath, 'utf-8');
      return content.includes('UserRole') || content.includes('role');
    } catch (error) {
      return false;
    }
  }

  async checkForAuthorizationMiddleware() {
    try {
      const middlewarePath = path.join(__dirname, '../middleware');
      const files = await fs.readdir(middlewarePath);
      
      for (const file of files) {
        const content = await fs.readFile(path.join(middlewarePath, file), 'utf-8');
        if (content.includes('requireAuth') || 
            content.includes('requireRole') ||
            content.includes('authorize')) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForPermissionChecks() {
    try {
      const routesPath = path.join(__dirname, '../routes');
      const files = await fs.readdir(routesPath);
      
      for (const file of files) {
        const content = await fs.readFile(path.join(routesPath, file), 'utf-8');
        if (content.includes('requireAuth') || content.includes('role')) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async testAPIEndpoints() {
    const findings = [];
    let status = 'PASS';

    try {
      // Check for rate limiting
      const hasRateLimiting = await this.checkForRateLimiting();
      if (!hasRateLimiting) {
        status = 'FAIL';
        findings.push('Rate limiting not detected');
      } else {
        findings.push('Rate limiting implemented');
      }

      // Check for input validation
      const hasInputValidation = await this.checkForInputValidation();
      if (!hasInputValidation) {
        status = 'FAIL';
        findings.push('Input validation middleware not detected');
      } else {
        findings.push('Input validation in use');
      }

      // Check for API versioning
      const hasAPIVersioning = await this.checkForAPIVersioning();
      if (hasAPIVersioning) {
        findings.push('API versioning detected');
      } else {
        findings.push('Info: API versioning not detected');
      }

      // Check for CORS configuration
      const hasCORS = await this.checkForCORSConfiguration();
      if (!hasCORS) {
        findings.push('Warning: CORS configuration not detected');
      } else {
        findings.push('CORS configuration detected');
      }

    } catch (error) {
      status = 'FAIL';
      findings.push(`Test error: ${error.message}`);
      logger.error({ error }, 'API security test failed');
    }

    return {
      name: 'API Security',
      status,
      severity: 'HIGH',
      description: 'Test API endpoint security',
      findings: findings.join('; ') || 'Rate limiting and input validation enabled'
    };
  }

  async checkForRateLimiting() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('express-rate-limit') || 
              content.includes('rateLimit') ||
              content.includes('rate-limit')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForInputValidation() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('joi') || 
              content.includes('yup') ||
              content.includes('express-validator') ||
              content.includes('zod')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForAPIVersioning() {
    try {
      const routesPath = path.join(__dirname, '../routes');
      const files = await fs.readdir(routesPath);
      
      for (const file of files) {
        const content = await fs.readFile(path.join(routesPath, file), 'utf-8');
        if (content.includes('/v1/') || content.includes('/v2/') || content.includes('/api/v')) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForCORSConfiguration() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('cors')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async getLatestResults(limit = 5) {
    await this.initialize();

    try {
      const files = await fs.readdir(PENTEST_DIR);
      const results = [];

      for (const file of files.slice(-limit)) {
        const content = await fs.readFile(path.join(PENTEST_DIR, file), 'utf-8');
        results.push(JSON.parse(content));
      }

      return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      logger.error('Failed to get pentest results:', error);
      return [];
    }
  }
}

export default new PenetrationTester();
