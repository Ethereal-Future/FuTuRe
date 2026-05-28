const fs = require('fs');
const path = require('path');

class MobileTestMonitor {
    constructor() {
        this.reportsDir = path.join(__dirname, 'reports');
        this.logsDir = path.join(__dirname, 'logs');
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.reportsDir)) {
            fs.mkdirSync(this.reportsDir, { recursive: true });
        }
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    logTestResult(testName, status, duration, details = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            testName,
            status,
            duration,
            details
        };

        const logFile = path.join(this.logsDir, `test-log-${new Date().toISOString().split('T')[0]}.json`);
        let logs = [];

        if (fs.existsSync(logFile)) {
            logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        }

        logs.push(logEntry);
        fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));

        console.log(`📝 Logged test result: ${testName} - ${status}`);
    }

    generateSummaryReport() {
        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(this.logsDir, `test-log-${today}.json`);

        if (!fs.existsSync(logFile)) {
            console.log('No test logs found for today.');
            return;
        }

        const logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        const summary = {
            date: today,
            totalTests: logs.length,
            passedTests: logs.filter(log => log.status === 'passed').length,
            failedTests: logs.filter(log => log.status === 'failed').length,
            averageDuration: logs.reduce((sum, log) => sum + log.duration, 0) / logs.length,
            slowestTest: logs.reduce((slowest, log) => log.duration > slowest.duration ? log : slowest, logs[0])
        };

        const summaryFile = path.join(this.reportsDir, `summary-${today}.json`);
        fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

        console.log('📊 Summary report generated:', summary);
        return summary;
    }

    checkThresholds() {
        const summary = this.generateSummaryReport();
        if (!summary) return;

        const alerts = [];

        if (summary.failedTests > 0) {
            alerts.push(`🚨 ${summary.failedTests} tests failed today`);
        }

        if (summary.averageDuration > 30000) { // 30 seconds
            alerts.push(`⏱️ Average test duration is high: ${summary.averageDuration}ms`);
        }

        if (alerts.length > 0) {
            console.log('⚠️ Alerts:', alerts.join(', '));
            // Here you could send notifications, emails, etc.
        }
    }
}

module.exports = MobileTestMonitor;

// Usage example
if (require.main === module) {
    const monitor = new MobileTestMonitor();

    // Simulate logging some test results
    monitor.logTestResult('Mobile Homepage Load', 'passed', 2500, { device: 'iPhone 12' });
    monitor.logTestResult('Touch Gesture Test', 'failed', 1500, { error: 'Element not found' });
    monitor.logTestResult('Orientation Test', 'passed', 3200, { orientation: 'landscape' });

    monitor.checkThresholds();
}</content>
<parameter name="filePath">/workspaces/FuTuRe/mobile-tests/monitor.js