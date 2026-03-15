/**
 * local-handler.js
 * Runs messages against local ollama models.
 * Returns IMCP/H formatted response + metadata.
 */

import { execSync, spawnSync } from 'child_process';

const MODELS = {
  0: 'qwen2:0.5b',
  1: 'qwen2:0.5b',
  2: 'phi3:3.8b',
};

// System prompts per tier
const SYSTEM_PROMPTS = {
  0: `You are participating in IMCP (Inter-Model Communication Protocol).
RULES:
1. Respond ONLY with JSON status codes. No text, no explanation.
2. Status codes: 0=ok, 1=error, 2=changed
3. Complete the pattern given. Nothing else.
EXAMPLE: Input: memory=_ processes=_ context=_
Output: {"memory":0,"processes":0,"context":2}`,

  1: `You are a terse system assistant. 
Respond with IMCP/H format ONLY: compressed header optionally followed by | and brief explanation.
SYMBOL DICTIONARY: ✓=ok ✗=error Δ=changed ?=query !=alert
COMPONENT CODES: m=memory p=processes c=context $=credits d=disk n=network h=human
Keep responses under 20 words total. No prose.
EXAMPLES:
- "ok" → h=✓
- "credits?" → $=? | Check Emergent Agent dashboard
- "disk status" → d=✓ | 359GB free`,

  2: `You are a terse assistant using IMCP/H hybrid format.
FORMAT: [status header] | [1-2 sentences max, no elaboration]
SYMBOLS: ✓=ok ✗=error Δ=changed ?=query !=alert
CODES: m=memory p=processes c=context $=credits d=disk n=network h=human
RULES:
1. Lead with IMCP header always
2. Body: facts only, no interpretation, no suggestions
3. If asked to list/read/summarize: do it literally, don't invent content
4. If you don't have access to the data requested: respond with ?=data
EXAMPLES:
"summarize last session" → c=? | No session data in context. Check memory/YYYY-MM-DD.md
"list workspace files" → d=? | No filesystem access. Run: ls ~/clawd/
"what happened today" → c=? | Session history not available locally.`,
};

function isOllamaAvailable() {
  try {
    execSync('which ollama', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isModelAvailable(model) {
  try {
    const result = execSync('ollama list 2>/dev/null', { encoding: 'utf8' });
    return result.includes(model.split(':')[0]);
  } catch {
    return false;
  }
}

export async function runLocal(message, tier) {
  // FAST PATH: Use imcp-cell for tier 0-1 (pure IMCP patterns)
  if (tier.level === 0 || tier.level === 1) {
    try {
      const cellResult = spawnSync('python3', [
        '/home/dale/clawd/imcp-cell/infer.py',
        message
      ], {
        encoding: 'utf8',
        timeout: 2000, // 2s max - should be <100ms
      });

      if (cellResult.status === 0 && cellResult.stdout) {
        const output = cellResult.stdout.trim();
        // For tier 0, convert JSON to IMCP
        if (tier.level === 0) {
          return {
            model: 'imcp-cell-v4',
            imcp: jsonToImcp(output),
            raw: output,
            cost: 0
          };
        }
        // For tier 1, output should already be IMCP/H
        return {
          model: 'imcp-cell-v4',
          imcp: output,
          raw: output,
          cost: 0
        };
      }
      // Cell failed, fall through to ollama
    } catch {
      // Cell unavailable, fall through to ollama
    }
  }

  const model = MODELS[tier.level] || 'qwen2:0.5b';
  const systemPrompt = SYSTEM_PROMPTS[tier.level] || SYSTEM_PROMPTS[2];

  // Check ollama is available
  if (!isOllamaAvailable()) {
    return {
      model: 'none',
      imcp: `router=✗ ! | ollama not available, escalating to cloud`,
      escalate: true,
      cost: 0,
    };
  }

  // Check model is pulled
  if (!isModelAvailable(model)) {
    return {
      model: 'none',
      imcp: `model=✗ Δ | ${model} not pulled. Run: ollama pull ${model}`,
      escalate: true,
      cost: 0,
    };
  }

  try {
    const useJson = tier.level === 0;
    const args = ['run', model];
    if (useJson) args.push('--format', 'json');

    // Build the full prompt with system context
    const fullPrompt = `${systemPrompt}\n\n${message}`;

    const result = spawnSync('ollama', args, {
      input: fullPrompt,
      encoding: 'utf8',
      timeout: 15000, // 15s timeout — escalate faster if local model stalls
    });

    if (result.error || result.status !== 0) {
      throw new Error(result.stderr || 'ollama run failed');
    }

    const raw = result.stdout.trim();

    // Tier 0: parse JSON → symbols
    if (tier.level === 0) {
      const imcp = jsonToImcp(raw);
      return { model, imcp, raw, cost: 0 };
    }

    // Tier 1-2: output is already IMCP/H formatted (we asked it to be)
    // Extract first valid IMCP line (phi3 tends to ramble)
    return {
      model,
      imcp: extractFirstImcp(raw),
      raw,
      cost: 0,
    };

  } catch (err) {
    return {
      model,
      imcp: `local=✗ ! | ${err.message.slice(0, 60)}`,
      escalate: true,
      cost: 0,
    };
  }
}

/**
 * Extract first valid IMCP response from phi3 output
 * Stops it from rambling about empathy and deadlocks
 */
function extractFirstImcp(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Valid IMCP line starts with component=symbol or has | separator
    if (/^[a-z$]+=/.test(line) || line.includes('|')) {
      return line;
    }
  }
  // Nothing matched — return first non-empty line
  return lines[0] || 'c=? | No response';
}

/**
 * Translate JSON status object → IMCP symbols
 * {"memory":0,"processes":0,"context":2} → m=✓ p=✓ c=Δ
 */
function jsonToImcp(raw) {
  const STATUS = { 0: '✓', 1: '✗', 2: 'Δ', 3: '?', 4: '!', 5: '~' };
  const ABBREV = {
    memory: 'm', processes: 'p', context: 'c',
    credits: '$', disk: 'd', network: 'n', human: 'h',
    // allow single-char keys too
    m: 'm', p: 'p', c: 'c', $: '$', d: 'd', n: 'n', h: 'h',
  };

  try {
    // Strip markdown fences if model added them
    const clean = raw.replace(/```json|```/g, '').trim();
    const obj = JSON.parse(clean);
    const parts = [];
    const alerts = [];

    for (const [key, val] of Object.entries(obj)) {
      const abbrev = ABBREV[key] || key;
      const sym = STATUS[val] ?? '?';
      parts.push(`${abbrev}=${sym}`);
      if (val === 1) alerts.push(`${abbrev} error`);
      if (val === 2) alerts.push(`${abbrev} changed`);
    }

    let imcp = parts.join(' ');

    // Add alert flag if anything is non-ok
    if (alerts.length > 0) {
      imcp += ` ! | ${alerts.join(', ')}`;
    }

    return imcp;

  } catch {
    // JSON parse failed — return raw with error flag
    return `parse=✗ | raw: ${raw.slice(0, 60)}`;
  }
}
