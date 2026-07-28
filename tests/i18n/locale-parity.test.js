import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '../../frontend/src/i18n/locales');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');

/**
 * Flattens nested JSON object into dot-notation keys
 * Example: { a: { b: 'value' } } => ['a.b']
 */
function flattenKeys(obj, prefix = '') {
  const keys = [];
  
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      keys.push(...flattenKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  
  return keys;
}

/**
 * Loads and flattens a locale JSON file
 */
function loadLocaleKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  return flattenKeys(json);
}

/**
 * Finds the difference between two arrays
 */
function arrayDiff(arr1, arr2) {
  return arr1.filter(item => !arr2.includes(item));
}

describe('Locale Key Parity', () => {
  const enKeys = loadLocaleKeys(EN_FILE);
  
  // Get all locale files except en.json
  const localeFiles = fs.readdirSync(LOCALES_DIR)
    .filter(file => file.endsWith('.json') && file !== 'en.json')
    .map(file => ({
      name: file,
      path: path.join(LOCALES_DIR, file),
      locale: file.replace('.json', '')
    }));

  describe('English source file', () => {
    it('should have a valid structure', () => {
      expect(enKeys.length).toBeGreaterThan(0);
      expect(fs.existsSync(EN_FILE)).toBe(true);
    });
  });

  // Test each locale file
  for (const localeFile of localeFiles) {
    describe(localeFile.name, () => {
      const localeKeys = loadLocaleKeys(localeFile.path);
      const missingKeys = arrayDiff(enKeys, localeKeys);
      const extraKeys = arrayDiff(localeKeys, enKeys);

      it('should have no missing keys compared to en.json', () => {
        expect(
          missingKeys,
          `${localeFile.name} is missing ${missingKeys.length} key(s): ${missingKeys.slice(0, 5).join(', ')}${missingKeys.length > 5 ? '...' : ''}`
        ).toEqual([]);
      });

      it('should have no extra keys not present in en.json', () => {
        expect(
          extraKeys,
          `${localeFile.name} has ${extraKeys.length} extra key(s) not in en.json: ${extraKeys.slice(0, 5).join(', ')}${extraKeys.length > 5 ? '...' : ''}`
        ).toEqual([]);
      });

      it('should have the same number of keys as en.json', () => {
        expect(localeKeys.length).toBe(enKeys.length);
      });
    });
  }

  describe('All locales combined', () => {
    it('should all have matching key structures', () => {
      const allLocalesMatch = localeFiles.every(localeFile => {
        const localeKeys = loadLocaleKeys(localeFile.path);
        const missingKeys = arrayDiff(enKeys, localeKeys);
        const extraKeys = arrayDiff(localeKeys, enKeys);
        return missingKeys.length === 0 && extraKeys.length === 0;
      });
      
      expect(allLocalesMatch).toBe(true);
    });
  });
});
