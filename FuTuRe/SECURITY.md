# Advanced Security Measures

Enterprise-level security features for the Stellar Remittance Platform.

## Features

### 1. OAuth 2.0 / OpenID Connect

Secure authentication and authorization framework.

```javascript
import { oauth2 } from './security/index.js';

// Register client
oauth2.registerClient('client-id', 'client-secret', ['http://localhost:3000/callback']);

// Generate authorization code
const code = oauth2.generateAuthorizationCode('client-id', 'user-id', 'read write');

// Exchange code for token
const token = oauth2.exchangeCodeForToken(code, 'client-id', 'client-secret');

// Validate token
const payload = oauth2.validateToken(token.accessToken);
```

**API Endpoints:**
- `POST /api/security/oauth/authorize` - Generate authorization code
- `POST /api/security/oauth/token` - Exchange code for token
- `POST /api/security/oauth/refresh` - Refresh access token

### 2. Multi-Factor Authentication (MFA)

TOTP-based MFA with backup codes.

```javascript
import { mfa } from './security/index.js';

// Generate secret
const { secret, qrCode } = mfa.generateSecret('user-id');

// Enable MFA
const backupCodes = mfa.enableMFA('user-id', secret);

// Verify TOTP
mfa.verifyTOTP('user-id', '123456');

// Verify backup code
mfa.verifyBackupCode('user-id', 'backup-code');
```

**API Endpoints:**
- `POST /api/security/mfa/setup` - Generate MFA secret
- `POST /api/security/mfa/enable` - Enable MFA
- `POST /api/security/mfa/verify` - Verify TOTP token

### 3. Security Audit Logging

Comprehensive audit trail for compliance.

```javascript
import { auditLogger } from './security/index.js';

// Log authentication attempt
await auditLogger.logAuthAttempt('user-id', true, '192.168.1.1', 'Mozilla/5.0');

// Log security event
await auditLogger.logSecurityEvent('UNAUTHORIZED_ACCESS', 'user-id', { reason: 'Invalid token' });

// Get audit logs
const logs = await auditLogger.getAuditLog('2024-03-25');

// Get security events
const events = await auditLogger.getSecurityEvents('CRITICAL');
```

**API Endpoints:**
- `GET /api/security/audit/logs` - Get audit logs
- `GET /api/security/audit/security-events` - Get security events

### 4. Threat Detection

Real-time threat detection and IP blocking.

```javascript
import { threatDetector } from './security/index.js';

// Record failed login
const result = threatDetector.recordFailedLogin('user-id', '192.168.1.1');

// Detect anomalous activity
const threats = threatDetector.detectAnomalousActivity('user-id', {
  amount: 15000,
  previousLocation: 'US',
  currentLocation: 'CN'
});

// Check if IP is blocked
const blocked = threatDetector.isIPBlocked('192.168.1.1');

// Block IP
threatDetector.blockIP('192.168.1.1', 'Excessive failed attempts');
```

**API Endpoints:**
- `POST /api/security/threats/check` - Check for threats
- `GET /api/security/threats/blocked-ips` - Get blocked IPs

### 5. Security Scanning

Automated security scanning for vulnerabilities.

```javascript
import { securityScanner } from './security/index.js';

// Scan dependencies
const depScan = await securityScanner.scanDependencies();

// Scan for secrets
const secretScan = await securityScanner.scanSecrets();

// Scan code quality
const qualityScan = await securityScanner.scanCodeQuality();

// Get latest scans
const scans = await securityScanner.getLatestScans(10);
```

**API Endpoints:**
- `POST /api/security/scan/dependencies` - Scan dependencies
- `POST /api/security/scan/secrets` - Scan for secrets
- `POST /api/security/scan/code-quality` - Scan code quality
- `GET /api/security/scan/latest` - Get latest scans

### 6. Incident Response

Automated incident response with playbooks.

```javascript
import { incidentResponse } from './security/index.js';

// Create incident
const incident = await incidentResponse.createIncident(
  'UNAUTHORIZED_ACCESS',
  'CRITICAL',
  'Unauthorized access detected',
  ['API_SERVER']
);

// Complete action
await incidentResponse.completeAction(incident.id, 'Block user account');

// Add note
await incidentResponse.addNote(incident.id, 'Investigation started');

// Get open incidents
const incidents = await incidentResponse.getOpenIncidents();
```

**API Endpoints:**
- `POST /api/security/incidents/create` - Create incident
- `GET /api/security/incidents/open` - Get open incidents
- `POST /api/security/incidents/:id/action` - Complete action

### 7. Penetration Testing

Automated security testing.

```javascript
import { penetrationTester } from './security/index.js';

// Run security tests
const results = await penetrationTester.runSecurityTests();

// Get latest results
const results = await penetrationTester.getLatestResults(5);
```

**Tests Included:**
- SQL Injection
- Cross-Site Scripting (XSS)
- Cross-Site Request Forgery (CSRF)
- Authentication
- Authorization
- API Security

**API Endpoints:**
- `POST /api/security/pentest/run` - Run security tests
- `GET /api/security/pentest/results` - Get test results

### 8. Compliance Reporting

Multi-framework compliance reporting.

```javascript
import { complianceReporter } from './security/index.js';

// Generate SOC2 report
const soc2 = await complianceReporter.generateComplianceReport('SOC2');

// Generate GDPR report
const gdpr = await complianceReporter.generateComplianceReport('GDPR');

// Generate HIPAA report
const hipaa = await complianceReporter.generateComplianceReport('HIPAA');

// Generate PCI-DSS report
const pciDss = await complianceReporter.generateComplianceReport('PCI-DSS');

// Generate annual report
const annual = await complianceReporter.generateAnnualReport();
```

**Supported Frameworks:**
- SOC2 Type II
- GDPR
- HIPAA
- PCI-DSS

**API Endpoints:**
- `POST /api/security/compliance/report` - Generate compliance report
- `GET /api/security/compliance/latest` - Get latest reports
- `POST /api/security/compliance/annual` - Generate annual report

## Storage Structure

```
data/
├── audit/              # Audit logs
├── incidents/          # Incident records
├── security-scans/     # Security scan results
├── pentests/           # Penetration test results
└── compliance/         # Compliance reports
```

## Security Best Practices

1. **OAuth 2.0**: Use authorization codes for user authentication
2. **MFA**: Require MFA for sensitive operations
3. **Audit Logging**: Log all security-relevant events
4. **Threat Detection**: Monitor for suspicious patterns
5. **Regular Scanning**: Run security scans regularly
6. **Incident Response**: Have playbooks for common incidents
7. **Penetration Testing**: Conduct regular security tests
8. **Compliance**: Maintain compliance with relevant frameworks

## Configuration

Set environment variables:

```bash
JWT_SECRET=your-secret-key
```

## Testing

Run security tests:

```bash
npm test -- security.test.js
```

## API Examples

### OAuth 2.0 Flow

```bash
# 1. Generate authorization code
curl -X POST http://localhost:3001/api/security/oauth/authorize \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client-1","userId":"user-1","scope":"read write"}'

# 2. Exchange code for token
curl -X POST http://localhost:3001/api/security/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"code":"...","clientId":"client-1","clientSecret":"secret-1"}'

# 3. Refresh token
curl -X POST http://localhost:3001/api/security/oauth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"...","clientId":"client-1"}'
```

### MFA Setup

```bash
# 1. Generate secret
curl -X POST http://localhost:3001/api/security/mfa/setup \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1"}'

# 2. Enable MFA
curl -X POST http://localhost:3001/api/security/mfa/enable \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","secret":"..."}'

# 3. Verify TOTP
curl -X POST http://localhost:3001/api/security/mfa/verify \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","token":"123456"}'
```

### Security Scanning

```bash
# Scan dependencies
curl -X POST http://localhost:3001/api/security/scan/dependencies

# Scan for secrets
curl -X POST http://localhost:3001/api/security/scan/secrets

# Get latest scans
curl http://localhost:3001/api/security/scan/latest?limit=10
```

### Compliance Reporting

```bash
# Generate SOC2 report
curl -X POST http://localhost:3001/api/security/compliance/report \
  -H "Content-Type: application/json" \
  -d '{"framework":"SOC2"}'

# Generate annual report
curl -X POST http://localhost:3001/api/security/compliance/annual
```

## Incident Response Playbooks

### Unauthorized Access
1. Block user account
2. Revoke all active sessions
3. Notify user
4. Log security event
5. Alert security team

### Data Breach
1. Isolate affected systems
2. Preserve evidence
3. Notify affected users
4. Contact authorities
5. Initiate forensics

### Malware Detection
1. Quarantine affected systems
2. Scan all systems
3. Update security definitions
4. Review logs
5. Restore from clean backup

### DDoS Attack
1. Enable rate limiting
2. Activate DDoS protection
3. Redirect traffic
4. Monitor metrics
5. Notify ISP

## Monitoring

Monitor security metrics:

```bash
# Get audit logs
curl http://localhost:3001/api/security/audit/logs

# Get security events
curl http://localhost:3001/api/security/audit/security-events?severity=CRITICAL

# Get open incidents
curl http://localhost:3001/api/security/incidents/open

# Get threat patterns
curl http://localhost:3001/api/security/threats/blocked-ips
```

## Future Enhancements

- Hardware security key support
- Biometric authentication
- Advanced threat intelligence
- Machine learning-based anomaly detection
- Blockchain-based audit trail
- Zero-trust architecture
- Quantum-resistant cryptography
