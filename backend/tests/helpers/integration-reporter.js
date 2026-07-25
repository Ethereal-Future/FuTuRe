import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

export default class IntegrationReporter {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  onTestFinished(test) {
    this.results.push({
      name: test.name,
      fullName: test.result?.state === 'fail' ? test.suite?.name + ' > ' + test.name : test.name,
      status: test.result?.state,
      duration: test.result?.duration,
      error: test.result?.errors?.[0]?.message
    });
  }

  onFinished(files) {
    const duration = (Date.now() - this.startTime) / 1000;
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const skipped = this.results.filter(r => r.status === 'skip').length;

    const summary = {
      timestamp: new Date().toISOString(),
      durationSeconds: duration,
      total: this.results.length,
      passed,
      failed,
      skipped,
      details: this.results
    };

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const reportDir = resolve(__dirname, '../../test-reports');
    
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(
      resolve(reportDir, 'integration-report.json'),
      JSON.stringify(summary, null, 2)
    );

    console.log('\n\x1b[36mIntegration Test Summary:\x1b[39m');
    console.log(`\x1b[32mPassed:  ${passed}\x1b[39m`);
    console.log(`\x1b[31mFailed:  ${failed}\x1b[39m`);
    console.log(`\x1b[34mSkipped: ${skipped}\x1b[39m`);
    console.log(`Duration: ${duration.toFixed(2)}s\n`);
    
    if (failed > 0) {
      console.log('\x1b[31mFailures:\x1b[39m');
      this.results.filter(r => r.status === 'fail').forEach(r => {
        console.log(`  - ${r.fullName}: \x1b[31m${r.error}\x1b[39m`);
      });
      console.log('\n');
    }
  }
}
