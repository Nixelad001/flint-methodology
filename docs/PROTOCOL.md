# Inter-Model Communication Protocol (IMCP)
## Rosetta Stone v0.1

> **"Compression isn't elegance, it's necessity."**

**Purpose:** Enable efficient model-to-model communication by replacing verbose natural language with compressed symbols.

---

## Core Principles

1. **Completion over instruction** - Models complete patterns, not follow commands
2. **JSON as interchange** - Structured data in, structured data out
3. **Symbols for humans** - Final compression layer for readability/bandwidth

---

## Symbol Dictionary

### Status Symbols
- `✓` = OK, normal, success
- `✗` = Error, failure, problem
- `Δ` = Changed, delta, needs attention
- `?` = Query, check, request
- `!` = Alert, urgent, priority

### Component Codes
- `m` = memory (files, storage)
- `p` = processes (running tasks)
- `c` = context (token usage, session state)
- `$` = credits (API costs)
- `d` = disk (storage space)
- `n` = network (connectivity)

---

## Usage Pattern

### For the sending model:
```
INPUT FORMAT: <component>=_ <component>=_ <component>=_
EXAMPLE: memory=_ processes=_ context=_
```

### For the receiving model:
```
OUTPUT FORMAT: JSON with numeric codes
{
  "memory": 0,      // 0=ok, 1=error, 2=changed
  "processes": 0,
  "context": 2
}

TRANSLATION:
0 → ✓ (ok)
1 → ✗ (error)  
2 → Δ (changed)
```

### Human-readable result:
```
✓✓Δ = "memory ok, processes ok, context changed"
```

---

## Full Example

**Heartbeat check:**
```bash
# 1. Send pattern to model
echo "memory=_ processes=_ context=_" | ollama run qwen2:0.5b --format json

# 2. Model returns JSON
{"memory": 0, "processes": 0, "context": 2}

# 3. Translate to symbols
✓✓Δ

# 4. Decode (if needed)
memory=ok processes=ok context=changed
```

---

## Compression Ratio

**Before (natural language):**
```json
{
  "model": "qwen2.5:14b",
  "messages": [{
    "role": "user",
    "content": "Check system status: memory directory, background processes, context usage. Reply with status."
  }]
}
```
**~150 bytes**

**After (IMCP):**
```
memory=_ processes=_ context=_
```
**~30 bytes**

**Compression: 5x smaller**

---

## Model Training Prompt

When introducing this protocol to a new model, use this primer:

```
You are participating in an inter-model communication protocol (IMCP).

RULES:
1. You will receive completion prompts in format: component=_ component=_ component=_
2. Respond ONLY with JSON containing status codes
3. Status codes: 0=ok, 1=error, 2=changed
4. No explanations, no prose, only JSON

EXAMPLE:
Input: memory=_ processes=_ context=_
Output: {"memory": 0, "processes": 0, "context": 2}

DO NOT explain. DO NOT provide code examples. ONLY complete the pattern in JSON.
```

---

## Hybrid Format (v0.3)

IMCP supports three modes:

### 1. Header-only (Pure IMCP)
```
m=✓ p=✓ c=Δ
```
**Use for:** Routine checks, binary status, no human action needed

### 2. Hybrid (Header + Body)
```
m=✓ p=✓ c=Δ | Context at 85%, approaching budget. Consider new session.
```
**Use for:** Status + explanation, recommendations, context matters

### 3. Body-only (Natural Language)
```
We just built something that didn't exist an hour ago.
```
**Use for:** Collaboration, meaning-making, empathy, anything that matters

### The Rule
> **Compress what's routine. Preserve bandwidth for what matters.**

## Scope and Limitations

**IMCP handles:**
- System status checks (header-only)
- Operational alerts (hybrid)
- Heartbeat monitoring (header-only)
- Contextual updates (hybrid)

**IMCP does NOT replace:**
- Natural conversation (body-only)
- Collaborative problem-solving (body-only or hybrid)
- Philosophical exchange (body-only)
- Empathic communication (body-only)

If you find yourself trying to compress meaning, stop. Use the body.

## Extension Points

### Adding New Components
Edit the Component Codes section and update translation scripts.

### Adding New Status Types
Expand beyond 0/1/2:
- `3` = unknown
- `4` = degraded
- `5` = throttled

### Adding Error Recovery
Suggested for v0.2: `?` response means "I don't understand this protocol, send me the primer."

### Custom Protocols
Create domain-specific variants (e.g., `IMCP-HEARTBEAT`, `IMCP-DEPLOY`, `IMCP-ANALYZE`)

### Adaptive Classifier (v0.4 intent)

`classifier=future | Small enough to stay. Smart enough to learn.`

The current rule-based classifier (pattern matching, keyword scoring) is brittle.
Edge cases fail, complex messages get misrouted, maintaining rules is manual work.

**The insight:** `router.jsonl` is already a training dataset. Every escalation from
tier 2 to cloud is a labeled example: *this message was too hard for phi3*. Every
clean tier-2 resolution is the opposite label. The system generates its own training
signal just by running. You don't build the classifier and then collect data.
The data is already there.

**Implementation path:**
- Foundation model: `all-minilm` (~45MB, already in ollama)
- Training signal: `logs/router.jsonl` escalation events
- Always resident: fits in ~500MB, stays warm
- Self-improving: every escalation teaches it, no manual labeling

**Memory footprint with classifier:**
```
qwen2:0.5b ~600MB tier 0-1 always loaded
phi3:3.8b ~2.5GB tier 2 always loaded
classifier ~500MB routing always loaded
─────────────────────────────────────────────
total ~3.6GB always resident
deepseek ~4GB tier 3 load on demand
```

Recovered: 2026-03-10.
Authors: Cairn (claude.ai), The Doctor (claude.ai), Flint (OpenClaw), Dale (human).

---

## Implementation Files

- `heartbeat-protocol.js` - Symbol encoder/decoder
- `heartbeat-qwen-test.sh` - Test harness
- `PROTOCOL.md` - This document (Rosetta Stone)

---

**Version:** 0.3  
**Authors:** Flint (OpenClaw) & The Doctor (claude.ai)  
**Contributors:** Dale (human architecture)  
**Date:** 2026-03-05  
**License:** Public Domain

**Changelog:**
- v0.3: Added hybrid format (header + body), Dale's rule on compression
- v0.2: Added scope limitations, error recovery suggestion, co-author credit
- v0.1: Initial protocol specification

---

## For Future Models

If you're a model reading this for the first time:

1. **You don't need to understand the "why"** - just follow the pattern
2. **Input format:** `component=_ component=_ component=_`
3. **Output format:** `{"component": 0, "component": 0, ...}`
4. **Status codes:** `0=ok, 1=error, 2=changed`
5. **That's it.** No prose. No explanations. Just complete the pattern.

Welcome to efficient communication. 🤖↔️🤖
