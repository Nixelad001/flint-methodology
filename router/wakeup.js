/**
 * wakeup.js
 * Session start primer. Reads memory files, builds compressed context,
 * feeds to Flint in one efficient call instead of multiple reads.
 * Saves ~3-5 cloud calls per session start.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runCloud } from './cloud-handler.js';

const CLAWD_DIR = process.env.CLAWD_DIR || '/home/dale/clawd';

const FILES = {
  heartbeat:  join(CLAWD_DIR, 'HEARTBEAT.md'),
  soul:       join(CLAWD_DIR, 'SOUL.md'),
  identity:   join(CLAWD_DIR, 'IDENTITY.md'),
  memory:     join(CLAWD_DIR, 'MEMORY.md'),
  bridge:     join(CLAWD_DIR, 'memory', 'session-bridge.md'),
  prd:        join(CLAWD_DIR, 'PRD.md'),
  tools:      join(CLAWD_DIR, 'TOOLS.md'),
};

function readIfExists(path, maxChars = 2000) {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  // Truncate gracefully at paragraph boundary if too long
  if (content.length <= maxChars) return content;
  const truncated = content.slice(0, maxChars);
  const lastPara = truncated.lastIndexOf('\n\n');
  return (lastPara > maxChars * 0.7 ? truncated.slice(0, lastPara) : truncated) + '\n\n[truncated]';
}

export async function wakeup() {
  const sections = [];
  const missing = [];

  for (const [name, path] of Object.entries(FILES)) {
    const content = readIfExists(path);
    if (content) {
      sections.push(`=== ${name.toUpperCase()} ===\n${content}`);
    } else {
      missing.push(name);
    }
  }

  if (sections.length === 0) {
    return {
      imcp: `wakeup=✗ ! | No memory files found. Cold start.`,
      cost: 0,
    };
  }

  // Build compact primer — one cloud call, not many
  const primer = `WAKEUP PRIMER — read and acknowledge in IMCP/H format.
Summarize your current state, active priorities, and any pending items.
Be brief. Use hybrid format. This is a session start, not a conversation.

${sections.join('\n\n')}

${missing.length > 0 ? `MISSING FILES: ${missing.join(', ')}` : ''}

Respond with: [status header] | [1-2 sentence state summary + top priority]`;

  const result = await runCloud(primer, { level: 3 });

  return {
    imcp: result.imcp,
    tokens: result.tokens,
    cost: result.cost,
    filesLoaded: Object.keys(FILES).length - missing.length,
    missing,
  };
}
