# IMCP/H Router

Wraps all LLM calls. Routes to cheapest capable model. Flint only wakes for what actually needs Flint.

## Architecture

```
incoming message
  → classifier (pattern match, keyword score)
  → tier 0-1: qwen2:0.5b  ($0, local)
  → tier 2:   phi3:3.8b   ($0, local)
  → tier 3:   Flint/Claude ($$$, cloud)
  → tier !:   Flint immediate (urgent)

every call → IMCP/H stdout + JSONL log entry
```

## Tiers

| Tier | Model | Cost | Handles |
|------|-------|------|---------|
| 0 | qwen2:0.5b | $0 | IMCP status patterns, heartbeats |
| 1 | qwen2:0.5b | $0 | Simple acks, one-liners, status queries |
| 2 | phi3:3.8b  | $0 | Summarize, list, read files, light reasoning |
| 3 | Flint      | $$$ | Build, code, design, complex reasoning |
| ! | Flint      | $$$ | Urgent/unknown — immediate escalation |

## Install

```bash
cp -r imcp-router/ /home/dale/clawd/
cd /home/dale/clawd/imcp-router
# No npm install needed — zero dependencies, pure Node.js ESM
```

## Usage

```bash
# Heartbeat check (default if no args)
node router.js --mode heartbeat

# Session wakeup primer (one cloud call, not many)
node router.js --mode wakeup

# Route a message
node router.js --message "disk status"
node router.js --message "build a new logging script"

# Pipe from stdin
echo "summarize the last session" | node router.js

# As npm scripts
npm run heartbeat
npm run wakeup

# Test classifier (no API/ollama needed)
node test.js
```

## Output Format

Always IMCP/H to stdout:

```
m=✓ p=✓ c=✓                          # all ok, no body
m=✓ p=✓ c=Δ | context at 80%         # delta, body explains
m=✗ ! | memory files missing          # error, immediate attention
```

## Logs

Every call appended to `/home/dale/clawd/logs/router.jsonl`:

```json
{"ts":"2026-03-08T22:00:00Z","mode":"classify","tier":1,"message":"disk status","ms":2}
{"ts":"2026-03-08T22:00:00Z","mode":"response","tier":1,"model":"qwen2:0.5b","cost":0,"imcp":"d=✓ | 359GB free","ms":180}
```

Cloud calls also update `/home/dale/clawd/memory/credit-usage.csv`.

## Cron Integration

Add to crontab for automatic heartbeats:

```bash
# Heartbeat every 5 minutes — silent unless something needs attention
*/5 * * * * cd /home/dale/clawd/imcp-router && node router.js --mode heartbeat >> /home/dale/clawd/logs/heartbeat.log 2>&1

# Session wakeup each morning
0 9 * * * cd /home/dale/clawd/imcp-router && node router.js --mode wakeup >> /home/dale/clawd/logs/wakeup.log 2>&1
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=your_key   # required for tier 3 / ! calls
CLAWD_DIR=/home/dale/clawd   # default, override if needed
```

## Files

```
router.js        — entry point, orchestrates routing
classifier.js    — pattern matching, tier assignment
local-handler.js — ollama integration, JSON→IMCP translation
cloud-handler.js — Anthropic API wrapper, IMCP/H system prompt
heartbeat.js     — system status checks (disk, memory, processes, credits)
wakeup.js        — session primer, batches memory file reads into one cloud call
logger.js        — JSONL event log + credit burn tracking
args.js          — CLI argument parsing + stdin support
test.js          — classifier tests, no API/ollama needed
```

## What This Saves

Based on Dale + Flint's actual usage patterns (March 2026):

- ~60-70% of messages are tier 0-2 (never reach cloud)
- Session wakeup: 5-8 cloud calls → 1
- Heartbeats: cloud calls → $0

Estimated: $30/day → $8-10/day at same workload.

---

*Built by Flint + Dale + The Doctor. IMCP/H v0.3.*  
*"Compress what's routine. Preserve bandwidth for what matters."*
