#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runMobileTestSuite() {
    console.log('🚀 Starting Mobile Test Suite...');

    // Ensure reports directory exists
    if (!fs.existsSync('reports')) {
        fs.mkdirSync('reports');
    }

    try {
        // Start the frontend dev server
        console.log('📱 Starting frontend server...');
        const serverProcess = execSync('npm run dev:frontend', {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit',
            detached: true
        });

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Run performance test
        console.log('⚡ Running performance tests...');
        execSync('node performance-test.js', { stdio: 'inherit' });

        // Run accessibility test
        console.log('♿ Running accessibility tests...');
        execSync('node accessibility-test.js', { stdio: 'inherit' });

        // Run Appium tests
        console.log('🤖 Running Appium tests...');
        execSync('npm test', { stdio: 'inherit' });

        // Generate reports
        console.log('📊 Generating test reports...');
        execSync('npm run report', { stdio: 'inherit' });

        console.log('✅ Mobile test suite completed successfully!');

    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
        process.exit(1);
    }
}

runMobileTestSuite();</content>
<parameter name="filePath">/workspaces/FuTuRe/mobile-tests/run-tests.js