describe('Mobile App Testing', () => {
    it('should load the homepage on mobile', async () => {
        await browser.url('/');
        const title = await browser.getTitle();
        expect(title).toBe('FuTuRe - Cross-border Remittance');
    });

    it('should display navigation menu on mobile', async () => {
        await browser.url('/');
        const navMenu = await $('nav');
        await expect(navMenu).toBeDisplayed();
    });

    it('should handle touch gestures', async () => {
        await browser.url('/');
        // Simulate swipe gesture
        const element = await $('body');
        await browser.touchAction([
            { action: 'press', element: element },
            { action: 'moveTo', element: element, x: 0, y: -100 },
            { action: 'release' }
        ]);
    });

    it('should work in portrait orientation', async () => {
        await browser.setOrientation('PORTRAIT');
        await browser.url('/');
        const viewport = await browser.getWindowSize();
        expect(viewport.width).toBeLessThan(viewport.height);
    });

    it('should work in landscape orientation', async () => {
        await browser.setOrientation('LANDSCAPE');
        await browser.url('/');
        const viewport = await browser.getWindowSize();
        expect(viewport.width).toBeGreaterThan(viewport.height);
    });
});</content>
<parameter name="filePath">/workspaces/FuTuRe/mobile-tests/test/specs/mobile.spec.js