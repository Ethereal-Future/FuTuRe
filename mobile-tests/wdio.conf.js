export const config = {
    // ====================
    // Runner Configuration
    // ====================
    runner: 'local',
    port: 4723,
    host: '127.0.0.1',

    // ============
    // Specs
    // ============
    specs: [
        './test/specs/**/*.js'
    ],
    // Patterns to exclude.
    exclude: [
        // 'path/to/excluded/files'
    ],

    // ============
    // Capabilities
    // ============
    capabilities: [{
        platformName: 'Android',
        'appium:platformVersion': '11.0',
        'appium:deviceName': 'emulator-5554',
        'appium:automationName': 'UiAutomator2',
        'appium:app': '', // For web testing, leave empty or use browserName
        browserName: 'Chrome',
        'appium:chromedriverExecutable': '', // Will be set automatically
    }],

    // ===================
    // Test Configurations
    // ===================
    logLevel: 'info',
    bail: 0,
    baseUrl: 'http://localhost:5173',
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    // ===================
    // Framework
    // ===================
    framework: 'mocha',
    reporters: [
        'spec',
        ['allure', {
            outputDir: 'allure-results',
            disableWebdriverStepsReporting: true,
            disableWebdriverScreenshotsReporting: false,
        }]
    ],

    // ===================
    // Hooks
    // ===================
    before: function (capabilities, specs) {
        // Setup code
    },

    after: function (result, capabilities, specs) {
        // Cleanup code
    },

    beforeTest: function (test, context) {
        // Test setup
    },

    afterTest: function (test, context, { error, result, duration, passed, retries }) {
        // Test cleanup
    }
}</content>
<parameter name="filePath">/workspaces/FuTuRe/mobile-tests/wdio.conf.js