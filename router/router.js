#!/usr/bin/env node
/**
 * IMCP/H Router Service
 * Wraps all LLM calls. Classifies intent, routes to cheapest capable model.
 * Flint (cloud) only wakes for tier=3 or tier=!
 *
 * Usage:
 *   node router.js --message "your message here"
 *   node router.js --mode heartbeat
 *   node router.js --mode wakeup
 *   echo "message" | node router.js
 *
 * Output: always IMCP/H format to stdout, JSONL log to logs/router.jsonl
 */

import { classify }   from './classifier.js';
import { runLocal }   from './local-handler.js';
import { runCloud }   from './cloud-handler.js';
import { logEvent }   from './logger.js';
import { wakeup }     from './wakeup.js';
import { heartbeat }  from './heartbeat.js';
import { parseArgs }  from './args.js';

const VERSION = '0.1.0';

async function route(input) {
  const startMs = Date.now();

  // --- Special modes ---
  if (input.mode === 'heartbeat') {
    const result = await heartbeat();
    await logEvent({ mode: 'heartbeat', ...result, ms: Date.now() - startMs });
    process.stdout.write(result.imcp + '\n');
    return;
  }

  if (input.mode === 'wakeup') {
    const result = await wakeup();
    await logEvent({ mode: 'wakeup', ...result, ms: Date.now() - startMs });
    process.stdout.write(result.imcp + '\n');
    return;
  }

  // --- Message routing ---
  const message = input.message;
  if (!message) {
    process.stdout.write('input=✗ ! | No message provided\n');
    process.exit(1);
  }

  // Classify
  const tier = await classify(message);
  await logEvent({ mode: 'classify', tier, message: message.slice(0, 80), ms: Date.now() - startMs });

  let result;

  if (tier.level <= 2) {
    // Local — free
    result = await runLocal(message, tier);
  } else {
    // Cloud — costs credits
    result = await runCloud(message, tier);
  }

  const ms = Date.now() - startMs;
  await logEvent({
    mode: 'response',
    tier: tier.level,
    model: result.model,
    tokens: result.tokens || null,
    cost: result.cost || null,
    imcp: result.imcp,
    ms,
  });

  process.stdout.write(result.imcp + '\n');
}

// --- Entry point ---
const input = await parseArgs();
await route(input);
