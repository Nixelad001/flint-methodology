#!/usr/bin/env node
/**
 * rollback.js
 * Restores openclaw.json to original state and stops proxy.
 * Run this if anything breaks after install.
 *
 * Usage: node rollback.js
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

const HOME        = homedir();
const CONFIG_DIR  = join(HOME, '.openclaw');
const CONFIG_PATH = join(CONFIG_DIR, 'openclaw.json');

// Find most recent IMCP backup
const backups = readdirSync(CONFIG_DIR)
  .filter(f => f.startsWith('openclaw.json.imcp-backup-'))
  .sort()
  .reverse();

if (backups.length === 0) {
  // Try restoring from embedded _imcp_original_baseUrl fields
  console.log('No backup file found. Attempting in-place restore...');

  if (!existsSync(CONFIG_PATH)) {
    console.error('✗ openclaw.json not found');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

  for (const [name, provider] of Object.entries(config?.models?.providers || {})) {
    if (provider._imcp_original_baseUrl) {
      console.log(`  Restoring ${name}: ${provider.baseUrl} → ${provider._imcp_original_baseUrl}`);
      config.models.providers[name].baseUrl = provider._imcp_original_baseUrl;
      delete config.models.providers[name]._imcp_original_baseUrl;
    }
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log('✓ openclaw.json restored from embedded backup');
} else {
  const backup = join(CONFIG_DIR, backups[0]);
  console.log(`Restoring from: ${backup}`);
  const original = readFileSync(backup, 'utf8');
  writeFileSync(CONFIG_PATH, original);
  console.log('✓ openclaw.json restored');
}

// Stop proxy service
try {
  execSync('systemctl --user stop imcp-proxy 2>/dev/null');
  execSync('systemctl --user disable imcp-proxy 2>/dev/null');
  console.log('✓ imcp-proxy service stopped');
} catch {
  console.log('  (proxy service was not running)');
}

console.log('\nrollback=✓ | Restart openclaw to reconnect to Emergent Agent directly.');
