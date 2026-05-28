#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const REPO = 'Ethereal-Future/FuTuRe';
const content = readFileSync(new URL('../ISSUES.md', import.meta.url), 'utf-8');

const blocks = content.split(/\n---\n/);
const issues = [];

for (const block of blocks) {
  const titleMatch = block.match(/^###\s+#\d+\s+—\s+(.+)$/m);
  if (!titleMatch) continue;

  const title = titleMatch[1].trim();

  const labelsMatch = block.match(/^\*\*Labels:\*\*\s+(.+)$/m);
  const labels = labelsMatch
    ? labelsMatch[1].match(/`([^`]+)`/g).map(l => l.replace(/`/g, ''))
    : [];

  const bodyStart = labelsMatch
    ? block.indexOf(labelsMatch[0]) + labelsMatch[0].length
    : block.indexOf(titleMatch[0]) + titleMatch[0].length;
  const body = block.slice(bodyStart).trim();

  issues.push({ title, labels, body });
}

console.log(`Found ${issues.length} issues. Creating on GitHub…\n`);

let created = 0, failed = 0;
const tmpFile = join(tmpdir(), 'gh-issue-body.md');

for (const issue of issues) {
  try {
    writeFileSync(tmpFile, issue.body, 'utf-8');
    const labelFlags = issue.labels.map(l => `--label "${l}"`).join(' ');
    const cmd = `gh issue create --repo "${REPO}" --title "${issue.title.replace(/"/g, '\\"')}" --body-file "${tmpFile}" ${labelFlags}`;
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✓ ${issue.title}`);
    created++;
  } catch (err) {
    const msg = err.stderr?.toString().trim() ?? err.message;
    // Labels that don't exist yet cause failure — retry without labels
    if (msg.includes('label')) {
      try {
        const cmd = `gh issue create --repo "${REPO}" --title "${issue.title.replace(/"/g, '\\"')}" --body-file "${tmpFile}"`;
        execSync(cmd, { stdio: 'pipe' });
        console.log(`✓ ${issue.title} (no labels — create them in GitHub first)`);
        created++;
      } catch (e2) {
        console.error(`✗ ${issue.title} — ${e2.stderr?.toString().trim() ?? e2.message}`);
        failed++;
      }
    } else {
      console.error(`✗ ${issue.title} — ${msg}`);
      failed++;
    }
  }
}

try { unlinkSync(tmpFile); } catch {}
console.log(`\nDone. Created: ${created}, Failed: ${failed}`);
