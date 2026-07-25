import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('#721 - Font and Icon Preloading', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = readFileSync(
      resolve(__dirname, '../../index.html'),
      'utf-8'
    );
  });

  it('should have link rel=preload for critical CSS', () => {
    expect(htmlContent).toMatch(/<link rel="preload"[^>]*as="style"[^>]*>/);
  });

  it('should preload index.css to avoid render-blocking CSS delay', () => {
    expect(htmlContent).toMatch(
      /<link rel="preload"[^>]*href="\/src\/index\.css"[^>]*>/
    );
  });

  it('should maintain manifest link for PWA support', () => {
    expect(htmlContent).toMatch(/<link rel="manifest"[^>]*>/);
  });

  it('should have theme-color meta tag for mobile branding', () => {
    expect(htmlContent).toMatch(/<meta name="theme-color"[^>]*content="#0066cc"/);
  });

  it('should have viewport meta for responsive design', () => {
    expect(htmlContent).toMatch(
      /<meta name="viewport"[^>]*content="width=device-width, initial-scale=1\.0"/
    );
  });

  it('should load main script as module (deferred)', () => {
    expect(htmlContent).toMatch(
      /<script type="module" src="\/src\/main\.jsx"><\/script>/
    );
  });
});
