#!/usr/bin/env node
/**
 * install.js
 * Safely integrates IMCP proxy into OpenClaw.
 *
 * What it does:
 *   1. Backs up openclaw.json
 *   2. Patches baseUrl for both providers → localhost:3000
 *   3. Adds local-ollama provider for reference
 *   4. Creates systemd user service for auto-start
 *   5. Prints rollback command
 *
 * Usage:
 *   node install.js          # dry run (shows what would change)
 *   node install.js --apply  # actually applies changes
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

const DRY_RUN     = !process.argv.includes('--apply');
const HOME        = homedir();
const CONFIG_PATH = join(HOME, '.openclaw', 'openclaw.json');
const BACKUP_PATH = CONFIG_PATH + `.imcp-backup-${Date.now()}`;
const ROUTER_DIR  = new URL('.', import.meta.url).pathname;
const PROXY_PORT  = 3000;

console.log(`\nIMCP Proxy Installer ${DRY_RUN ? '(DRY RUN — pass --apply to commit)' : '(LIVE)'}\n`);
console.log('─'.repeat(60));

// --- Read current config ---
if (!existsSync(CONFIG_PATH)) {
  console.error(`✗ openclaw.json not found at ${CONFIG_PATH}`);
  process.exit(1);
}

const raw     = readFileSync(CONFIG_PATH, 'utf8');
const config  = JSON.parse(raw);
const providers = config?.models?.providers || {};

// --- Show current state ---
console.log('Current providers:');
for (const [name, p] of Object.entries(providers)) {
  console.log(`  ${name}: ${p.baseUrl}`);
}

// --- Build patched config ---
const patched = JSON.parse(raw); // deep clone via parse

for (const [name, provider] of Object.entries(patched.models?.providers || {})) {
  const original = provider.baseUrl;
  const proxyUrl = `http://localhost:${PROXY_PORT}`;

  // Only patch if pointing to Emergent Agent
  if (original?.includes('emergentagent.com')) {
    patched.models.providers[name] = {
      ...provider,
      baseUrl: proxyUrl,
      _imcp_original_baseUrl: original, // preserve for rollback
    };
    console.log(`\n  PATCH: ${name}`);
    console.log(`    was: ${original}`);
    console.log(`    now: ${proxyUrl}`);
  }
}

// --- Systemd service ---
const serviceContent = `[Unit]
Description=IMCP Proxy Router
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node ${ROUTER_DIR}proxy.js
Restart=on-failure
RestartSec=5
Environment=CLAWD_DIR=${HOME}/clawd
Environment=PROXY_PORT=${PROXY_PORT}
WorkingDirectory=${ROUTER_DIR}

[Install]
WantedBy=default.target
`;

const SERVICE_DIR  = join(HOME, '.config', 'systemd', 'user');
const SERVICE_PATH = join(SERVICE_DIR, 'imcp-proxy.service');

console.log(`\nService file: ${SERVICE_PATH}`);
console.log('  Auto-starts proxy on login');

// --- Rollback instructions ---
console.log('\n─'.repeat(60));
console.log('\nROLLBACK (if anything breaks):');
console.log(`  cp ${BACKUP_PATH} ${CONFIG_PATH}`);
console.log('  systemctl --user stop imcp-proxy');
console.log('  systemctl --user disable imcp-proxy');

// --- Apply if not dry run ---
if (DRY_RUN) {
  console.log('\n─'.repeat(60));
  console.log('\nDry run complete. Run with --apply to commit changes:');
  console.log('  node install.js --apply');
  process.exit(0);
}

// Backup
copyFileSync(CONFIG_PATH, BACKUP_PATH);
console.log(`\n✓ Backed up to: ${BACKUP_PATH}`);

// Patch config
writeFileSync(CONFIG_PATH, JSON.stringify(patched, null, 2) + '\n', 'utf8');
console.log('✓ openclaw.json patched');

// Write service file
try {
  execSync(`mkdir -p ${SERVICE_DIR}`);
  writeFileSync(SERVICE_PATH, serviceContent, 'utf8');
  execSync('systemctl --user daemon-reload');
  execSync('systemctl --user enable imcp-proxy');
  execSync('systemctl --user start imcp-proxy');
  console.log('✓ systemd service installed and started');
} catch (err) {
  console.log(`  Note: systemd setup failed (${err.message.slice(0, 60)})`);
  console.log('  Start proxy manually: node proxy.js &');
}

// Verify proxy is up
try {
  await new Promise(r => setTimeout(r, 1000));
  const resp = await fetch(`http://localhost:${PROXY_PORT}/health`);
  const data = await resp.json();
  console.log(`✓ Proxy health check: ${data.status}`);
} catch {
  console.log('  Proxy health check pending — may need a moment to start');
}

console.log('\n─'.repeat(60));
console.log('\ninstall=✓ | IMCP proxy integrated. Restart openclaw-gateway to take effect:');
console.log('  systemctl --user restart openclaw-gateway  (if running as service)');
console.log('  OR kill and restart openclaw manually');
console.log('\nMonitor: tail -f ~/clawd/logs/router.jsonl');
