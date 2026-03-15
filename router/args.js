/**
 * args.js
 * Parse CLI arguments and stdin for router.js
 */

import { readFileSync } from 'fs';
import { stdin } from 'process';

export async function parseArgs() {
  const args = process.argv.slice(2);
  
  // Check for --mode flag
  const modeIdx = args.indexOf('--mode');
  if (modeIdx >= 0 && args[modeIdx + 1]) {
    return { mode: args[modeIdx + 1] };
  }
  
  // Check for --message flag
  const msgIdx = args.indexOf('--message');
  if (msgIdx >= 0 && args[msgIdx + 1]) {
    return { mode: 'message', message: args[msgIdx + 1] };
  }
  
  // Check for piped stdin
  if (!stdin.isTTY) {
    const chunks = [];
    for await (const chunk of stdin) {
      chunks.push(chunk);
    }
    const message = Buffer.concat(chunks).toString('utf8').trim();
    if (message) {
      return { mode: 'message', message };
    }
  }
  
  // Default: heartbeat mode
  return { mode: 'heartbeat' };
}
