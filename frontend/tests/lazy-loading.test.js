import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(__dirname, '../src/App.jsx'), 'utf-8');

const HEAVY_COMPONENTS = [
  'AMMPoolBrowser',
  'AccountRecovery',
  'MultiSigTransactions',
  'KYCForm',
  'ComplianceDashboard',
  'BackupSettings',
];

describe('code splitting — heavy components', () => {
  for (const name of HEAVY_COMPONENTS) {
    it(`${name} is not statically imported`, () => {
      // A static import would look like: import { Foo } from './components/Foo'
      const staticImportPattern = new RegExp(`^import\\s+.*\\b${name}\\b.*from`, 'm');
      expect(appSource).not.toMatch(staticImportPattern);
    });

    it(`${name} uses React.lazy()`, () => {
      const lazyPattern = new RegExp(`lazy\\(.*import\\(.*${name}.*\\)`, 's');
      expect(appSource).toMatch(lazyPattern);
    });
  }

  it('lazy components are wrapped in Suspense at each render site', () => {
    // Count Suspense occurrences — at least one per heavy component
    const suspenseCount = (appSource.match(/<Suspense\b/g) ?? []).length;
    expect(suspenseCount).toBeGreaterThanOrEqual(HEAVY_COMPONENTS.length);
  });

  it('each heavy component module can be dynamically imported', async () => {
    // Confirms the modules exist and export the expected named export
    const modules = await Promise.all(
      HEAVY_COMPONENTS.map(name =>
        import(`../src/components/${name}.jsx`).then(m => ({ name, exported: name in m }))
      )
    );
    for (const { name, exported } of modules) {
      expect(exported, `${name} should export a named member`).toBe(true);
    }
  });
});
