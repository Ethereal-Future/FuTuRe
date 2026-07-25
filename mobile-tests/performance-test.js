const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

async function runPerformanceTest() {
    const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
    });

    const options = {
        logLevel: 'info',
        output: 'json',
        port: chrome.port,
        emulatedFormFactor: 'mobile'
    };

    const runnerResult = await lighthouse('http://localhost:5173', options);

    console.log('Performance Report:');
    console.log('Performance Score:', runnerResult.lhr.categories.performance.score * 100);
    console.log('Accessibility Score:', runnerResult.lhr.categories.accessibility.score * 100);
    console.log('Best Practices Score:', runnerResult.lhr.categories['best-practices'].score * 100);
    console.log('SEO Score:', runnerResult.lhr.categories.seo.score * 100);

    await chrome.kill();
}

runPerformanceTest().catch(console.error);</content>
<parameter name="filePath">/workspaces/FuTuRe/mobile-tests/performance-test.js