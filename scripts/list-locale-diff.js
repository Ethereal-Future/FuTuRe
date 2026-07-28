#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '../frontend/src/i18n/locales');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');

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

function loadLocaleKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  return flattenKeys(json);
}

function arrayDiff(arr1, arr2) {
  return arr1.filter(item => !arr2.includes(item));
}

const enKeys = loadLocaleKeys(EN_FILE);

// List missing keys in es.json
const esKeys = loadLocaleKeys(path.join(LOCALES_DIR, 'es.json'));
const esMissing = arrayDiff(enKeys, esKeys);

console.log('Missing in es.json:');
esMissing.forEach(key => console.log(key));

console.log('\n\nMissing in he.json:');
// List missing keys in he.json
const heKeys = loadLocaleKeys(path.join(LOCALES_DIR, 'he.json'));
const heMissing = arrayDiff(enKeys, heKeys);
heMissing.forEach(key => console.log(key));

console.log('\n\nExtra in ar.json:');
// List extra keys in ar.json
const arKeys = loadLocaleKeys(path.join(LOCALES_DIR, 'ar.json'));
const arExtra = arrayDiff(arKeys, enKeys);
arExtra.forEach(key => console.log(key));
