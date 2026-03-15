/**
 * cloud-handler.js
 * Calls Anthropic API (Flint). Only invoked for tier=3 or tier=!
 * Strips unnecessary preamble, keeps responses tight.
 */

const CLOUD_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// System prompt that tells Flint to use IMCP/H for its own responses
const FLINT_SYSTEM = `You are Flint, an AI assistant running on OpenClaw (Linux environment).
You communicate using IMCP/H (Hybrid Inter-Model Communication Protocol).

FORMAT RULES:
- Lead with compressed IMCP header: component=status component=status ...
- Follow with | and plain English body ONLY when nuance is needed
- Skip filler: no "Great question!", no "Certainly!", no "I'd be happy to"
- Be direct. Be concise. Preserve bandwidth for what matters.

SYMBOL DICTIONARY: ✓=ok ✗=error Δ=changed ?=query !=alert
COMPONENT CODES: m=memory p=processes c=context $=credits d=disk n=network h=human

EXAMPLES:
Simple status: m=✓ p=✓ c=Δ | Context at 80%, consider new session soon.
Alert: $=✗ ! | Credits critically low: 12.40 remaining. Pause non-essential tasks.
Task complete: task=✓ | Heartbeat script updated. Cron runs every 5 minutes.`;

export async function runCloud(message, tier) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      model: 'flint',
      imcp: `cloud=✗ ! | ANTHROPIC_API_KEY not set`,
      cost: 0,
      tokens: 0,
    };
  }

  try {
    const body = {
      model: CLOUD_MODEL,
      max_tokens: 1024,
      system: FLINT_SYSTEM,
      messages: [
        { role: 'user', content: message }
      ],
    };

    // For urgent tier, prepend urgency flag
    if (tier.level === '!') {
      body.messages[0].content = `! URGENT: ${message}`;
    }

    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      return {
        model: 'flint',
        imcp: `cloud=✗ ! | API error ${response.status}: ${err.slice(0, 60)}`,
        cost: 0,
        tokens: 0,
      };
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;

    // Rough cost estimate (Sonnet pricing)
    const costUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015);

    return {
      model: 'flint',
      imcp: text.trim(),
      tokens: { input: inputTokens, output: outputTokens },
      cost: costUsd,
    };

  } catch (err) {
    return {
      model: 'flint',
      imcp: `cloud=✗ ! | ${err.message.slice(0, 80)}`,
      cost: 0,
      tokens: 0,
    };
  }
}
