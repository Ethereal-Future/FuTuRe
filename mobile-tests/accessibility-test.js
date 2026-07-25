const Axe = require('axe-core');
const puppeteer = require('puppeteer');

async function runAccessibilityTest() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 667, isMobile: true }); // iPhone SE viewport

    await page.goto('http://localhost:5173');

    await page.addScriptTag({ content: Axe.source });

    const results = await page.evaluate(() => {
        return new Promise((resolve) => {
            axe.run((err, results) => {
                if (err) throw err;
                resolve(results);
            });
        });
    });

    console.log('Accessibility Violations:', results.violations.length);
    results.violations.forEach((violation, index) => {
        console.log(`${index + 1}. ${violation.id}: ${violation.description}`);
        console.log(`   Impact: ${violation.impact}`);
        console.log(`   Help: ${violation.help}`);
    });

    await browser.close();
}

runAccessibilityTest().catch(console.error);</content>
<parameter name="filePath">/workspaces/FuTuRe/mobile-tests/accessibility-test.js