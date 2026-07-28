#!/usr/bin/env node

/**
 * Locale Key Parity Checker
 * 
 * Compares all locale files against en.json to ensure:
 * 1. All locale files have the same keys as en.json (no missing keys)
 * 2. No locale files have extra keys not present in en.json (no orphaned keys)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '../frontend/src/i18n/locales');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');

/**
 * Flattens nested JSON object into dot-notation keys
 * Example: { a: { b: 'value' } } => { 'a.b': 'value' }
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
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    return flattenKeys(json);
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
    process.exit(1);
  }
}

/**
 * Finds the difference between two arrays
 */
function arrayDiff(arr1, arr2) {
  return arr1.filter(item => !arr2.includes(item));
}

function main() {
  console.log('🔍 Checking locale key parity...\n');
  
  // Load English (source of truth) keys
  const enKeys = loadLocaleKeys(EN_FILE);
  console.log(`✓ Loaded ${enKeys.length} keys from en.json\n`);
  
  // Get all locale files except en.json
  const localeFiles = fs.readdirSync(LOCALES_DIR)
    .filter(file => file.endsWith('.json') && file !== 'en.json')
    .map(file => ({
      name: file,
      path: path.join(LOCALES_DIR, file),
      locale: file.replace('.json', '')
    }));
  
  let hasErrors = false;
  const results = [];
  
  // Check each locale file
  for (const localeFile of localeFiles) {
    const localeKeys = loadLocaleKeys(localeFile.path);
    const missingKeys = arrayDiff(enKeys, localeKeys);
    const extraKeys = arrayDiff(localeKeys, enKeys);
    
    results.push({
      locale: localeFile.locale,
      name: localeFile.name,
      totalKeys: localeKeys.length,
      missingKeys,
      extraKeys
    });
    
    if (missingKeys.length > 0) {
      hasErrors = true;
      console.log(`❌ ${localeFile.name}: Missing ${missingKeys.length} key(s)`);
      if (missingKeys.length <= 10) {
        missingKeys.forEach(key => console.log(`   - ${key}`));
      } else {
        missingKeys.slice(0, 10).forEach(key => console.log(`   - ${key}`));
        console.log(`   ... and ${missingKeys.length - 10} more`);
      }
      console.log();
    }
    
    if (extraKeys.length > 0) {
      hasErrors = true;
      console.log(`❌ ${localeFile.name}: Extra ${extraKeys.length} key(s) not in en.json`);
      if (extraKeys.length <= 10) {
        extraKeys.forEach(key => console.log(`   - ${key}`));
      } else {
        extraKeys.slice(0, 10).forEach(key => console.log(`   - ${key}`));
        console.log(`   ... and ${extraKeys.length - 10} more`);
      }
      console.log();
    }
    
    if (missingKeys.length === 0 && extraKeys.length === 0) {
      console.log(`✓ ${localeFile.name}: All keys match (${localeKeys.length} keys)`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log('='.repeat(60));
  
  for (const result of results) {
    const status = result.missingKeys.length === 0 && result.extraKeys.length === 0 ? '✓' : '❌';
    console.log(`${status} ${result.name}: ${result.totalKeys} keys (${result.missingKeys.length} missing, ${result.extraKeys.length} extra)`);
  }
  
  if (hasErrors) {
    console.log('\n❌ Locale key parity check failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All locale files have matching keys!');
    process.exit(0);
  }
}

main();
