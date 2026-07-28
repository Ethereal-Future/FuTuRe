#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '../frontend/src/i18n/locales');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');
const AR_FILE = path.join(LOCALES_DIR, 'ar.json');

function loadJSON(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function getKeyPaths(obj, prefix = '') {
  const paths = {};
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(paths, getKeyPaths(obj[key], fullKey));
    } else {
      paths[fullKey] = obj[key];
    }
  }
  return paths;
}

function deleteKeyFromPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) return;
    current = current[parts[i]];
  }
  
  delete current[parts[parts.length - 1]];
  
  // Clean up empty parent objects
  for (let i = parts.length - 2; i >= 0; i--) {
    const parentPath = parts.slice(0, i + 1).join('.');
    let parent = obj;
    for (const part of parts.slice(0, i)) {
      parent = parent[part];
    }
    const currentObj = parent[parts[i]];
    if (currentObj && typeof currentObj === 'object' && Object.keys(currentObj).length === 0) {
      delete parent[parts[i]];
    } else {
      break;
    }
  }
}

const enKeys = getKeyPaths(loadJSON(EN_FILE));
const arData = loadJSON(AR_FILE);
const arKeys = getKeyPaths(arData);

const extraKeys = Object.keys(arKeys).filter(key => !enKeys.hasOwnProperty(key));

console.log(`Found ${extraKeys.length} extra keys in ar.json`);

// Remove extra keys
extraKeys.forEach(key => {
  console.log(`Removing: ${key}`);
  deleteKeyFromPath(arData, key);
});

// Write back with proper formatting
fs.writeFileSync(AR_FILE, JSON.stringify(arData, null, 2) + '\n', 'utf8');

console.log(`\n✓ Removed ${extraKeys.length} extra keys from ar.json`);
