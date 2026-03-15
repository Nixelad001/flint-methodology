/**
 * classifier.js
 * Determines the routing tier for a given message.
 *
 * Tiers:
 *   0 = pure status / heartbeat pattern   → qwen2:0.5b, $0
 *   1 = simple confirmation / ack         → qwen2:0.5b, $0
 *   2 = light reasoning / summarize       → phi3:3.8b,  $0
 *   3 = complex / creative / build        → Flint,      $$$
 *   ! = urgent / ambiguous / unknown      → Flint immediate
 */

// Tier 0: IMCP status patterns — model just completes the blank
const TIER0_PATTERNS = [
  /^[a-z$]+=_(\s+[a-z$]+=_)*\s*$/i,          // m=_ p=_ c=_
  /^(m|p|c|d|n|h|\$)=[✓✗Δ?!]/,               // m=✓ p=✓ ...
  /^heartbeat$/i,
  /^status(\s+check)?$/i,
  /^ping$/i,
  /HEARTBEAT_OK/,
];

// Tier 1: Simple confirmations, acks, one-liners
const TIER1_PATTERNS = [
  /^(ok|okay|got it|noted|understood|sure|yes|no|yep|nope|k|cool|done|good|great|thanks|ty)\.?$/i,
  /^(sound good|looks good|that works|makes sense)\.?$/i,
  /^(confirmed?|affirmative|negative)\.?$/i,
  /^(how much|how many|what is|what's)\s+(disk|memory|ram|vram|credit|token|context)/i,
  /^credits?[=?]?\??$/i,
  /^(disk|memory|cpu|ram|vram)\s*(usage|status|check)?$/i,
  /^session (status|context|tokens?)(\?)?$/i,
];

// Tier 2: Light reasoning — phi3 can handle these
const TIER2_PATTERNS = [
  /^summarize\s/i,
  /^(what (did|does|is|are)|explain briefly|describe)\s/i,
  /^(list|show me|display)\s/i,
  /^(read|cat|view|check)\s+\S+\.(md|txt|json|log)$/i,
  /^(ls|dir|find)\s/i,
  /^git\s+(status|log|diff)/i,
  /^(what happened|recap|brief)/i,
];

// Tier !: Always escalate regardless of pattern
const URGENT_PATTERNS = [
  /(!|alert|urgent|emergency|critical|broken|down|fail)/i,
  /\bsecurity\b/i,
  /inject/i,
  /\berror\b.*\bproduction\b/i,
];

// Keywords that push toward tier 3 (cloud)
const CLOUD_KEYWORDS = [
  'build', 'create', 'write', 'code', 'implement', 'design',
  'analyze', 'research', 'think', 'decide', 'plan', 'strategy',
  'help me', 'how do i', 'what should', 'opinion', 'review',
  'debug', 'fix this', 'why is', 'explain why',
];

export async function classify(message) {
  // Strip OpenClaw metadata wrapper if present
  let msg = message.trim();
  const metadataMatch = msg.match(/^Sender \(untrusted metadata\):[\s\S]*?```\n([\s\S]*)/);
  if (metadataMatch) {
    msg = metadataMatch[1].trim();
  }

  // Urgent — always cloud, immediately
  for (const p of URGENT_PATTERNS) {
    if (p.test(msg)) {
      return { level: '!', reason: 'urgent pattern matched', pattern: p.toString() };
    }
  }

  // Tier 0 — pure IMCP status
  for (const p of TIER0_PATTERNS) {
    if (p.test(msg)) {
      return { level: 0, reason: 'status pattern', model: 'qwen2:0.5b' };
    }
  }

  // Tier 1 — simple ack / one-liner
  for (const p of TIER1_PATTERNS) {
    if (p.test(msg)) {
      return { level: 1, reason: 'simple confirmation', model: 'qwen2:0.5b' };
    }
  }

  // Tier 2 — light reasoning
  for (const p of TIER2_PATTERNS) {
    if (p.test(msg)) {
      return { level: 2, reason: 'light reasoning', model: 'phi3:3.8b' };
    }
  }

  // Score cloud keywords
  const msgLower = msg.toLowerCase();
  const cloudScore = CLOUD_KEYWORDS.filter(k => msgLower.includes(k)).length;

  if (cloudScore >= 2) {
    return { level: 3, reason: `cloud keywords: ${cloudScore}`, model: 'flint' };
  }

  // Default: cloud (safe fallback, local is explicit opt-in only via patterns)
  return { level: 3, reason: 'unclassified, defaulting to cloud', model: 'flint' };
}
