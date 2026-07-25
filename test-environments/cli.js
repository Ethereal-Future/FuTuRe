#!/usr/bin/env node
/**
 * CLI for test environment management.
 *
 * Usage:
 *   node test-environments/cli.js provision <name>
 *   node test-environments/cli.js status
 *   node test-environments/cli.js monitor
 *   node test-environments/cli.js teardown <id>
 *   node test-environments/cli.js cleanup
 *   node test-environments/cli.js list
 *   node test-environments/cli.js history
 */

import { provision, teardown, teardownAll, getActive, monitor, listConfigs, getHistory } from './registry.js';

const [, , cmd, arg] = process.argv;

const commands = {
  provision(name) {
    if (!name) return console.error('Usage: provision <name>');
    const env = provision(name);
    console.log(`✓ Provisioned: ${env.name} [${env.id}] v${env.version}`);
    console.log('  Vars:', Object.keys(env.vars).join(', '));
  },

  status() {
    const active = getActive();
    const entries = Object.values(active);
    if (!entries.length) return console.log('No active environments.');
    entries.forEach((e) => console.log(`  [${e.id}] ${e.name} v${e.version} — ${e.status} since ${e.provisionedAt}`));
  },

  monitor() {
    const snapshot = monitor();
    if (!snapshot.length) return console.log('No active environments.');
    snapshot.forEach((e) =>
      console.log(`  [${e.id}] ${e.name} v${e.version} — ${e.status} uptime: ${(e.uptimeMs / 1000).toFixed(1)}s`)
    );
  },

  teardown(id) {
    if (!id) return console.error('Usage: teardown <id>');
    teardown(id);
    console.log(`✓ Torn down: ${id}`);
  },

  cleanup() {
    teardownAll();
    console.log('✓ All environments cleaned up.');
  },

  list() {
    listConfigs().forEach((c) => console.log(`  ${c.name} v${c.version} — ${c.description}`));
  },

  history() {
    const h = getHistory();
    if (!h.length) return console.log('No history.');
    h.slice(-20).forEach((e) => console.log(`  [${e.event}] ${e.name ?? e.id} @ ${e.provisionedAt ?? e.tornDownAt}`));
  },
};

const fn = commands[cmd];
if (!fn) {
  console.error(`Unknown command: ${cmd}\nAvailable: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
fn(arg);
