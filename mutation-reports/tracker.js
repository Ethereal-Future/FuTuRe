/**
 * Mutation score tracker.
 *
 * Reads the Stryker JSON report and:
 * - Tracks score history in mutation-reports/history.json
 * - Detects regressions vs the previous run
 * - Exits with code 1 if score drops below threshold or regresses
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_FILE = path.join(__dirname, 'mutation-report.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

const BREAK_THRESHOLD = 50;
const REGRESSION_TOLERANCE = 5;

function loadReport() {
  if (!fs.existsSync(REPORT_FILE)) {
    console.error('No mutation report found. Run: npm run test:mutation first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
}

function calcTotals(report) {
  let killed = 0, survived = 0, timeout = 0, noCoverage = 0;
  for (const file of Object.values(report.files ?? {})) {
    for (const m of file.mutants ?? []) {
      if (m.status === 'Killed') killed++;
      else if (m.status === 'Survived') survived++;
      else if (m.status === 'Timeout') timeout++;
      else if (m.status === 'NoCoverage') noCoverage++;
    }
  }
  return { killed, survived, timeout, noCoverage };
}

function calcScore({ killed, survived, timeout, noCoverage }) {
  const total = killed + survived + timeout + noCoverage;
  if (total === 0) return 100;
  return Math.round(((killed + timeout) / total) * 100);
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  // Ensure newline at end of file for git
  fs.appendFileSync(HISTORY_FILE, '\n');
}

function generateJobSummary(score, totals, previous) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const delta = previous ? score - previous.score : null;
  const statusEmoji = score >= 80 ? '✅' : score >= 60 ? '⚠️' : '❌';

  let summary = `# Mutation Testing Results\n\n`;
  summary += `${statusEmoji} **Score: ${score}%**\n\n`;
  summary += `## Mutation Breakdown\n`;
  summary += `| Metric | Count |\n`;
  summary += `|--------|-------|\n`;
  summary += `| Killed | ${totals.killed} |\n`;
  summary += `| Survived | ${totals.survived} |\n`;
  summary += `| Timeout | ${totals.timeout} |\n`;
  summary += `| No Coverage | ${totals.noCoverage} |\n\n`;

  if (previous) {
    summary += `## Trend\n`;
    summary += `| Metric | Value |\n`;
    summary += `|--------|-------|\n`;
    summary += `| Previous Score | ${previous.score}% |\n`;
    summary += `| Current Score | ${score}% |\n`;
    summary += `| Delta | ${delta >= 0 ? '+' : ''}${delta}% |\n\n`;
  }

  summary += `## Thresholds\n`;
  summary += `| Level | Threshold | Status |\n`;
  summary += `|-------|-----------|--------|\n`;
  summary += `| Break | ≥${BREAK_THRESHOLD}% | ${score >= BREAK_THRESHOLD ? '✅ Pass' : '❌ Fail'} |\n`;
  summary += `| Low | ≥60% | ${score >= 60 ? '✅ Pass' : '⚠️ Warning'} |\n`;
  summary += `| High (Target) | ≥80% | ${score >= 80 ? '✅ Pass' : '⚠️ Below Target'} |\n`;

  fs.writeFileSync(summaryFile, summary);
}

function run() {
  const report = loadReport();
  const totals = calcTotals(report);
  const score = calcScore(totals);
  const history = loadHistory();
  const previous = history[history.length - 1];

  history.push({ score, timestamp: new Date().toISOString(), totals });
  saveHistory(history);

  console.log(`\nMutation Score: ${score}%`);
  console.log(`  Killed: ${totals.killed}  Survived: ${totals.survived}  Timeout: ${totals.timeout}  No coverage: ${totals.noCoverage}`);

  if (previous) {
    const delta = score - previous.score;
    console.log(`  Previous: ${previous.score}%  Delta: ${delta >= 0 ? '+' : ''}${delta}%`);
    if (delta < -REGRESSION_TOLERANCE) {
      console.error(`\n⚠ ALERT: Mutation score dropped by ${Math.abs(delta)}% (tolerance: ${REGRESSION_TOLERANCE}%)`);
      generateJobSummary(score, totals, previous);
      process.exit(1);
    }
  }

  if (score < BREAK_THRESHOLD) {
    console.error(`\n✗ Mutation score ${score}% is below the required threshold of ${BREAK_THRESHOLD}%`);
    generateJobSummary(score, totals, previous);
    process.exit(1);
  }

  console.log(`\n✓ Mutation score ${score}% meets threshold (≥${BREAK_THRESHOLD}%)`);
  generateJobSummary(score, totals, previous);
}

run();
