/**
 * logger.js
 * Appends structured JSONL entries to logs/router.jsonl
 * Also maintains daily credit burn tracking.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const CLAWD_DIR = process.env.CLAWD_DIR || '/home/dale/clawd';
const LOG_DIR = join(CLAWD_DIR, 'logs');
const ROUTER_LOG = join(LOG_DIR, 'router.jsonl');
const CREDIT_CSV = join(CLAWD_DIR, 'memory', 'credit-usage.csv');

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export async function logEvent(event) {
  ensureDir(LOG_DIR);

  const entry = {
    ts: new Date().toISOString(),
    ...event,
  };

  try {
    appendFileSync(ROUTER_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // Don't crash the router if logging fails
    process.stderr.write(`log=✗ | ${err.message}\n`);
  }

  // Track credit spend if this was a cloud call
  if (event.cost && event.cost > 0) {
    trackCreditBurn(event.cost);
  }
}

function trackCreditBurn(costUsd) {
  ensureDir(dirname(CREDIT_CSV));

  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(CREDIT_CSV)) {
    writeFileSync(CREDIT_CSV, 'date,balance,daily_burn,note\n', 'utf8');
  }

  // Read existing entries
  const lines = readFileSync(CREDIT_CSV, 'utf8').trim().split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1);

  // Find today's entry
  const todayIdx = dataLines.findIndex(l => l.startsWith(today));

  if (todayIdx >= 0) {
    // Update today's burn
    const parts = dataLines[todayIdx].split(',');
    const currentBurn = parseFloat(parts[2] || 0);
    parts[2] = (currentBurn + costUsd).toFixed(6);
    dataLines[todayIdx] = parts.join(',');
  } else {
    // New day entry (balance unknown until manually updated)
    dataLines.push(`${today},?,${costUsd.toFixed(6)},auto-tracked`);
  }

  writeFileSync(CREDIT_CSV, [header, ...dataLines].join('\n') + '\n', 'utf8');
}
