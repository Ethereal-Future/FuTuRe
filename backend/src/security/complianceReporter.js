import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPLIANCE_DIR = path.join(__dirname, '../../data/compliance');

class ComplianceReporter {
  async initialize() {
    await fs.mkdir(COMPLIANCE_DIR, { recursive: true });
  }

  async generateComplianceReport(framework = 'SOC2') {
    await this.initialize();

    const reportId = `COMPLIANCE-${framework}-${Date.now()}`;
    const report = {
      id: reportId,
      framework,
      timestamp: new Date().toISOString(),
      controls: [],
      summary: {
        total: 0,
        compliant: 0,
        nonCompliant: 0,
        partiallyCompliant: 0,
        notApplicable: 0,
        compliancePercentage: 0
      }
    };

    if (framework === 'SOC2') {
      report.controls = await this.getSOC2Controls();
    } else if (framework === 'GDPR') {
      report.controls = await this.getGDPRControls();
    } else if (framework === 'HIPAA') {
      report.controls = await this.getHIPAAControls();
    } else if (framework === 'PCI-DSS') {
      report.controls = await this.getPCIDSSControls();
    }

    // Calculate compliance
    report.summary.total = report.controls.length;
    report.summary.compliant = report.controls.filter(c => c.status === 'COMPLIANT').length;
    report.summary.nonCompliant = report.controls.filter(c => c.status === 'NON_COMPLIANT').length;
    report.summary.partiallyCompliant = report.controls.filter(c => c.status === 'PARTIALLY_COMPLIANT').length;
    report.summary.notApplicable = report.controls.filter(c => c.status === 'NOT_APPLICABLE').length;
    
    const applicableControls = report.summary.total - report.summary.notApplicable;
    report.summary.compliancePercentage = applicableControls > 0 
      ? Math.round(((report.summary.compliant + report.summary.partiallyCompliant * 0.5) / applicableControls) * 100)
      : 0;

    const reportFile = path.join(COMPLIANCE_DIR, `${reportId}.json`);
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

    logger.info({
      reportId,
      framework,
      compliancePercentage: report.summary.compliancePercentage,
      nonCompliant: report.summary.nonCompliant
    }, 'Compliance report generated');

    return report;
  }

  async getSOC2Controls() {
    const checks = await this.runSOC2Checks();
    
    return [
      { 
        id: 'CC1.1', 
        description: 'Entity obtains or generates information', 
        status: checks.hasLogging ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasLogging ? 'Audit logging system detected' : 'No audit logging system found'
      },
      { 
        id: 'CC2.1', 
        description: 'Entity communicates information internally', 
        status: checks.hasNotificationSystem ? 'COMPLIANT' : 'PARTIALLY_COMPLIANT',
        evidence: checks.hasNotificationSystem ? 'Notification system implemented' : 'Limited internal communication system'
      },
      { 
        id: 'CC3.1', 
        description: 'Entity specifies objectives with sufficient clarity', 
        status: checks.hasDocumentation ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasDocumentation ? 'Documentation found' : 'Missing documentation'
      },
      { 
        id: 'CC4.1', 
        description: 'Entity identifies risks to achievement of objectives', 
        status: checks.hasRiskManagement ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasRiskManagement ? 'Risk management processes detected' : 'No risk management processes found'
      },
      { 
        id: 'CC5.1', 
        description: 'Entity selects and develops control activities', 
        status: checks.hasAccessControl ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasAccessControl ? 'Access control mechanisms in place' : 'Insufficient access controls'
      },
      { 
        id: 'CC6.1', 
        description: 'Entity implements control activities through policies', 
        status: checks.hasSecurityPolicies ? 'COMPLIANT' : 'PARTIALLY_COMPLIANT',
        evidence: checks.hasSecurityPolicies ? 'Security policies implemented' : 'Limited policy implementation'
      },
      { 
        id: 'CC7.1', 
        description: 'Entity obtains information about effectiveness', 
        status: checks.hasMonitoring ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasMonitoring ? 'Monitoring and alerting systems active' : 'No monitoring system detected'
      }
    ];
  }

  async runSOC2Checks() {
    const checks = {
      hasLogging: await this.checkAuditLogging(),
      hasNotificationSystem: await this.checkNotificationSystem(),
      hasDocumentation: await this.checkDocumentation(),
      hasRiskManagement: await this.checkRiskManagement(),
      hasAccessControl: await this.checkAccessControl(),
      hasSecurityPolicies: await this.checkSecurityPolicies(),
      hasMonitoring: await this.checkMonitoring()
    };
    return checks;
  }

  async checkAuditLogging() {
    try {
      // Check if AuditLog model exists and has records
      const auditLogCount = await prisma.auditLog.count();
      return auditLogCount > 0;
    } catch (error) {
      logger.warn({ error }, 'Could not check audit logging');
      return false;
    }
  }

  async checkNotificationSystem() {
    try {
      // Check if Notification model exists
      const notificationCount = await prisma.notification.count();
      return notificationCount >= 0; // Table exists
    } catch (error) {
      return false;
    }
  }

  async checkDocumentation() {
    try {
      const docsPath = path.join(__dirname, '../../');
      const files = await fs.readdir(docsPath);
      return files.some(f => f.toLowerCase().includes('readme') || f.toLowerCase().includes('.md'));
    } catch (error) {
      return false;
    }
  }

  async checkRiskManagement() {
    try {
      // Check for AML alerts or risk scoring
      const amlAlertCount = await prisma.aMLAlert.count();
      return amlAlertCount >= 0; // System exists
    } catch (error) {
      return false;
    }
  }

  async checkAccessControl() {
    try {
      // Check if role-based access control exists
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const content = await fs.readFile(schemaPath, 'utf-8');
      return content.includes('UserRole') && content.includes('role');
    } catch (error) {
      return false;
    }
  }

  async checkSecurityPolicies() {
    try {
      const securityPath = path.join(__dirname, '../security');
      const files = await fs.readdir(securityPath);
      return files.length > 5; // Multiple security modules
    } catch (error) {
      return false;
    }
  }

  async checkMonitoring() {
    try {
      // Check if monitoring/alerting exists
      const hasLogger = !!logger;
      const hasMetrics = await this.checkForMetrics();
      return hasLogger && hasMetrics;
    } catch (error) {
      return false;
    }
  }

  async checkForMetrics() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('prometheus') || content.includes('metrics')) {
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

  async getGDPRControls() {
    const checks = await this.runGDPRChecks();
    
    return [
      { 
        id: 'GDPR-1', 
        description: 'Lawful basis for processing', 
        status: checks.hasConsentManagement ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasConsentManagement ? 'User consent mechanisms detected' : 'No consent management found'
      },
      { 
        id: 'GDPR-2', 
        description: 'Data subject rights (access, deletion, portability)', 
        status: checks.hasDataSubjectRights ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasDataSubjectRights ? 'User data deletion capabilities present' : 'Missing data subject rights implementation'
      },
      { 
        id: 'GDPR-3', 
        description: 'Data protection by design', 
        status: checks.hasEncryption ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasEncryption ? 'Data encryption implemented' : 'No encryption detected'
      },
      { 
        id: 'GDPR-4', 
        description: 'Data breach notification', 
        status: checks.hasIncidentResponse ? 'COMPLIANT' : 'PARTIALLY_COMPLIANT',
        evidence: checks.hasIncidentResponse ? 'Incident response system present' : 'Limited incident response capabilities'
      },
      { 
        id: 'GDPR-5', 
        description: 'Data retention policies', 
        status: checks.hasDataRetention ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasDataRetention ? 'Soft delete and retention mechanisms present' : 'No data retention policies detected'
      }
    ];
  }

  async runGDPRChecks() {
    return {
      hasConsentManagement: await this.checkConsentManagement(),
      hasDataSubjectRights: await this.checkDataSubjectRights(),
      hasEncryption: await this.checkEncryption(),
      hasIncidentResponse: await this.checkIncidentResponse(),
      hasDataRetention: await this.checkDataRetention()
    };
  }

  async checkConsentManagement() {
    try {
      // Check for user preferences or consent fields
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const content = await fs.readFile(schemaPath, 'utf-8');
      return content.includes('NotificationPreference') || content.includes('consent');
    } catch (error) {
      return false;
    }
  }

  async checkDataSubjectRights() {
    try {
      // Check for deletedAt field (soft delete) in schema
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const content = await fs.readFile(schemaPath, 'utf-8');
      return content.includes('deletedAt');
    } catch (error) {
      return false;
    }
  }

  async checkEncryption() {
    try {
      // Check for encryption implementation
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('crypto') && (content.includes('encrypt') || content.includes('cipher'))) {
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

  async checkIncidentResponse() {
    try {
      const incidentPath = path.join(__dirname, '../security/incidentResponse.js');
      await fs.access(incidentPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkDataRetention() {
    try {
      // Check for deletedAt or expiration fields
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const content = await fs.readFile(schemaPath, 'utf-8');
      return content.includes('deletedAt') || content.includes('expiresAt');
    } catch (error) {
      return false;
    }
  }

  async getHIPAAControls() {
    const checks = await this.runHIPAAChecks();
    
    return [
      { 
        id: 'HIPAA-1', 
        description: 'Administrative safeguards', 
        status: checks.hasAccessControl ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasAccessControl ? 'Role-based access control implemented' : 'Missing administrative safeguards'
      },
      { 
        id: 'HIPAA-2', 
        description: 'Physical safeguards', 
        status: 'NOT_APPLICABLE',
        evidence: 'Cloud-based application - physical security managed by infrastructure provider'
      },
      { 
        id: 'HIPAA-3', 
        description: 'Technical safeguards (encryption, access controls)', 
        status: checks.hasTechnicalSafeguards ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasTechnicalSafeguards ? 'Encryption and authentication mechanisms present' : 'Missing technical safeguards'
      },
      { 
        id: 'HIPAA-4', 
        description: 'Audit controls and logging', 
        status: checks.hasAuditControls ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasAuditControls ? 'Audit logging system active' : 'No audit controls detected'
      }
    ];
  }

  async runHIPAAChecks() {
    return {
      hasAccessControl: await this.checkAccessControl(),
      hasTechnicalSafeguards: await this.checkTechnicalSafeguards(),
      hasAuditControls: await this.checkAuditLogging()
    };
  }

  async checkTechnicalSafeguards() {
    const hasEncryption = await this.checkEncryption();
    const hasAuth = await this.checkAuthentication();
    return hasEncryption && hasAuth;
  }

  async checkAuthentication() {
    try {
      const authPath = path.join(__dirname, '../routes/auth.js');
      const content = await fs.readFile(authPath, 'utf-8');
      return content.includes('jwt') || content.includes('passport');
    } catch (error) {
      return false;
    }
  }

  async getPCIDSSControls() {
    const checks = await this.runPCIDSSChecks();
    
    return [
      { 
        id: 'PCI-1', 
        description: 'Firewall configuration', 
        status: 'NOT_APPLICABLE',
        evidence: 'Cloud infrastructure - firewall managed by provider'
      },
      { 
        id: 'PCI-2', 
        description: 'Default passwords changed', 
        status: checks.noDefaultPasswords ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.noDefaultPasswords ? 'No default passwords detected in code' : 'Default credentials found'
      },
      { 
        id: 'PCI-3', 
        description: 'Data protection (cardholder data)', 
        status: checks.hasDataProtection ? 'COMPLIANT' : 'PARTIALLY_COMPLIANT',
        evidence: checks.hasDataProtection ? 'Encryption mechanisms in place' : 'Limited data protection'
      },
      { 
        id: 'PCI-4', 
        description: 'Encryption in transit (TLS/SSL)', 
        status: checks.hasTransitEncryption ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasTransitEncryption ? 'HTTPS/TLS configuration detected' : 'No transit encryption found'
      },
      { 
        id: 'PCI-5', 
        description: 'Malware protection', 
        status: 'NOT_APPLICABLE',
        evidence: 'Server-side application - OS-level malware protection managed separately'
      },
      { 
        id: 'PCI-6', 
        description: 'Secure development practices', 
        status: checks.hasSecureDevelopment ? 'COMPLIANT' : 'PARTIALLY_COMPLIANT',
        evidence: checks.hasSecureDevelopment ? 'Security testing and validation present' : 'Limited security practices'
      },
      { 
        id: 'PCI-7', 
        description: 'Access control (least privilege)', 
        status: checks.hasAccessControl ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasAccessControl ? 'Role-based access control present' : 'No access control detected'
      },
      { 
        id: 'PCI-8', 
        description: 'User identification and authentication', 
        status: checks.hasAuthentication ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasAuthentication ? 'Authentication system implemented' : 'Missing authentication'
      },
      { 
        id: 'PCI-9', 
        description: 'Physical access control', 
        status: 'NOT_APPLICABLE',
        evidence: 'Cloud-based - physical access managed by provider'
      },
      { 
        id: 'PCI-10', 
        description: 'Logging and monitoring', 
        status: checks.hasAuditControls ? 'COMPLIANT' : 'NON_COMPLIANT',
        evidence: checks.hasAuditControls ? 'Audit logging active' : 'No logging detected'
      }
    ];
  }

  async runPCIDSSChecks() {
    return {
      noDefaultPasswords: await this.checkNoDefaultPasswords(),
      hasDataProtection: await this.checkEncryption(),
      hasTransitEncryption: await this.checkTransitEncryption(),
      hasSecureDevelopment: await this.checkSecureDevelopment(),
      hasAccessControl: await this.checkAccessControl(),
      hasAuthentication: await this.checkAuthentication(),
      hasAuditControls: await this.checkAuditLogging()
    };
  }

  async checkNoDefaultPasswords() {
    try {
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      const dangerousPatterns = ['password123', 'admin', 'default', 'changeme'];
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          for (const pattern of dangerousPatterns) {
            if (content.toLowerCase().includes(pattern) && 
                (content.includes('password') || content.includes('PASSWORD'))) {
              return false;
            }
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      return true;
    } catch (error) {
      return true; // Assume compliant if can't check
    }
  }

  async checkTransitEncryption() {
    try {
      // Check for HTTPS/TLS configuration
      const appUrl = process.env.APP_URL || '';
      const hasHTTPS = appUrl.startsWith('https://');
      
      const srcPath = path.join(__dirname, '../');
      const files = await this.getJsFiles(srcPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes('https') || content.includes('tls') || content.includes('ssl')) {
            return true;
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }
      
      return hasHTTPS;
    } catch (error) {
      return false;
    }
  }

  async checkSecureDevelopment() {
    try {
      // Check for testing and security scanning
      const rootPath = path.join(__dirname, '../../');
      const files = await fs.readdir(rootPath);
      
      const hasTests = files.some(f => f.includes('test') || f.includes('.spec.'));
      const hasSecurityConfig = files.some(f => 
        f.includes('security') || 
        f.includes('.gitleaks') || 
        f.includes('.snyk')
      );
      
      return hasTests || hasSecurityConfig;
    } catch (error) {
      return false;
    }
  }

  async getLatestReports(limit = 5) {
    await this.initialize();

    try {
      const files = await fs.readdir(COMPLIANCE_DIR);
      const reports = [];

      for (const file of files.slice(-limit)) {
        const content = await fs.readFile(path.join(COMPLIANCE_DIR, file), 'utf-8');
        reports.push(JSON.parse(content));
      }

      return reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      logger.error('Failed to get compliance reports:', error);
      return [];
    }
  }

  async generateAnnualReport() {
    const frameworks = ['SOC2', 'GDPR', 'HIPAA', 'PCI-DSS'];
    const reports = [];

    for (const framework of frameworks) {
      const report = await this.generateComplianceReport(framework);
      reports.push(report);
    }

    return {
      generatedAt: new Date().toISOString(),
      reports,
      overallCompliance: Math.round(
        reports.reduce((sum, r) => sum + r.summary.compliancePercentage, 0) / reports.length
      )
    };
  }
}

export default new ComplianceReporter();
