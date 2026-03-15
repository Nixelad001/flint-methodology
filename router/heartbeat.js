/**
 * heartbeat.js
 * Runs system status check using qwen2:0.5b locally.
 * Checks: memory files, processes, context proxy, disk, credits file.
 * Returns IMCP/H formatted result.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const CLAWD_DIR = process.env.CLAWD_DIR || '/home/dale/clawd';
const CREDITS_FILE = join(CLAWD_DIR, 'memory', 'credit-usage.csv');
const MEMORY_FILE = join(CLAWD_DIR, 'MEMORY.md');
const SESSION_BRIDGE = join(CLAWD_DIR, 'memory', 'session-bridge.md');
const LOG_DIR = join(CLAWD_DIR, 'logs');

function checkDisk() {
  try {
    const out = execSync("df -h / | tail -1 | awk '{print $4, $5}'", { encoding: 'utf8' }).trim();
    const [avail, pct] = out.split(' ');
    const usedPct = parseInt(pct);
    return { status: usedPct > 90 ? 1 : 0, detail: `${avail} free (${pct} used)` };
  } catch {
    return { status: 1, detail: 'disk check failed' };
  }
}

function checkMemoryFiles() {
  const required = [MEMORY_FILE, SESSION_BRIDGE];
  const missing = required.filter(f => !existsSync(f));
  if (missing.length > 0) return { status: 1, detail: `missing: ${missing.map(f => f.split('/').pop()).join(', ')}` };
  return { status: 0, detail: 'all memory files present' };
}

function checkProcesses() {
  try {
    const out = execSync('pgrep -c ollama 2>/dev/null || echo 0', { encoding: 'utf8' }).trim();
    const ollamaRunning = parseInt(out) > 0;
    return { status: 0, detail: ollamaRunning ? 'ollama running' : 'ollama idle' };
  } catch {
    return { status: 0, detail: 'processes nominal' };
  }
}

function checkCredits() {
  if (!existsSync(CREDITS_FILE)) {
    return { status: 2, detail: 'no credit tracking file yet' };
  }
  try {
    const lines = readFileSync(CREDITS_FILE, 'utf8').trim().split('\n');
    const last = lines[lines.length - 1];
    const [date, balance, burn] = last.split(',');
    const bal = parseFloat(balance);
    if (bal < 10) return { status: 1, detail: `$${bal} remaining — critical` };
    if (bal < 20) return { status: 2, detail: `$${bal} remaining — low` };
    return { status: 0, detail: `$${bal} remaining` };
  } catch {
    return { status: 2, detail: 'credit file unreadable' };
  }
}

function checkLogs() {
  if (!existsSync(LOG_DIR)) return { status: 2, detail: 'log dir missing' };
  return { status: 0, detail: 'log dir present' };
}

const STATUS_SYM = { 0: '✓', 1: '✗', 2: 'Δ' };

export async function heartbeat() {
  const checks = {
    m: checkMemoryFiles(),
    p: checkProcesses(),
    d: checkDisk(),
    $: checkCredits(),
    n: checkLogs(),
  };

  const parts = [];
  const alerts = [];
  const body = [];

  for (const [code, result] of Object.entries(checks)) {
    const sym = STATUS_SYM[result.status] ?? '?';
    parts.push(`${code}=${sym}`);
    if (result.status === 1) alerts.push(`${code}=✗`);
    if (result.status === 2) body.push(`${code}: ${result.detail}`);
    if (result.status === 1) body.push(`${code}: ${result.detail}`);
  }

  let imcp = parts.join(' ');

  const hasAlert = alerts.length > 0;
  const hasDelta = body.length > 0;

  if (hasAlert) {
    imcp += ` ! | ${body.join(' · ')}`;
  } else if (hasDelta) {
    imcp += ` | ${body.join(' · ')}`;
  }
  // All ✓ → no body, pure IMCP

  return {
    imcp,
    checks,
    allOk: !hasAlert && !hasDelta,
  };
}
