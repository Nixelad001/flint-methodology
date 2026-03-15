#!/usr/bin/env node
/**
 * IMCP Proxy Server — v0.2 (streaming support)
 * Sits between OpenClaw and Emergent Agent.
 * Intercepts all LLM calls, classifies, routes to cheapest capable model.
 *
 * v0.2 fixes: SSE/streaming passthrough for OpenClaw v2026.3.8+
 *
 * OpenClaw config (ONE LINE per provider):
 *   "baseUrl": "http://localhost:3000"
 *
 * Flow:
 *   OpenClaw → proxy:3000 → classifier
 *     tier 0-2 → ollama (local, $0) — returned as non-streaming JSON
 *     tier 3/! → Emergent Agent (cloud) — streamed or JSON, passthrough
 */

import { createServer } from 'http';
import { classify }     from './classifier.js';
import { runLocal }     from './local-handler.js';
import { logEvent }     from './logger.js';

const PROXY_PORT      = process.env.PROXY_PORT || 3000;
const UPSTREAM_CLAUDE = 'https://integrations.emergentagent.com/llm';
const UPSTREAM_GPT    = 'https://integrations.emergentagent.com/llm/';

// Detect if request wants streaming
function wantsStreaming(body) {
  return body?.stream === true;
}

// Detect API type from path
function detectApiType(path) {
  if (path.includes('/messages')) return 'anthropic';
  if (path.includes('/chat/completions')) return 'openai';
  return 'anthropic';
}

// Extract last user message from either API format
function extractMessage(body, apiType) {
  try {
    if (apiType === 'anthropic') {
      const msgs = body.messages || [];
      const last = [...msgs].reverse().find(m => m.role === 'user');
      if (!last) return null;
      if (typeof last.content === 'string') return last.content;
      if (Array.isArray(last.content)) {
        return last.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
      }
    }
    if (apiType === 'openai') {
      const msgs = body.messages || [];
      const last = [...msgs].reverse().find(m => m.role === 'user');
      return typeof last?.content === 'string' ? last.content : null;
    }
  } catch {
    return null;
  }
  return null;
}

// Read full request body
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// Build Anthropic SSE stream from local text
// OpenClaw v2026.3.8 expects SSE even for simple responses when stream=true
function streamAnthropicLocal(res, text, model) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const msgId = `imcp-local-${Date.now()}`;

  // Anthropic SSE event sequence
  const events = [
    { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model, usage: { input_tokens: 0, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'ping' },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: text.split(' ').length } },
    { type: 'message_stop' },
  ];

  for (const event of events) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

// Build OpenAI SSE stream from local text
function streamOpenAILocal(res, text, model) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const id = `imcp-local-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // OpenAI SSE: one chunk per word for natural feel, then [DONE]
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = {
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: { content: (i === 0 ? '' : ' ') + words[i] }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  // Final chunk
  const final = {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };
  res.write(`data: ${JSON.stringify(final)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

// Build non-streaming JSON responses (for local tier 0-2 when stream=false)
function buildAnthropicResponse(text, model) {
  return {
    id: `imcp-local-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: text.split(' ').length },
  };
}

function buildOpenAIResponse(text, model) {
  return {
    id: `imcp-local-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: text.split(' ').length, total_tokens: 0 },
  };
}

// Forward to upstream — stream passthrough or JSON
async function forwardAndRespond(upstream, req, res, body, startMs, reason) {
  try {
    const upstreamUrl = upstream + req.url;
    const upstreamHeaders = { ...req.headers };
    delete upstreamHeaders['host'];
    delete upstreamHeaders['content-length'];

    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { ...upstreamHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const contentType = upstreamResp.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream') || wantsStreaming(body);

    if (isStream && upstreamResp.body) {
      // SSE passthrough — pipe upstream stream directly to client
      res.writeHead(upstreamResp.status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Track tokens from SSE for cost logging (best effort)
      let inputTokens = 0, outputTokens = 0;

      const reader = upstreamResp.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        // Try to extract usage from message_delta events
        const usageMatch = chunk.match(/"usage":\{"output_tokens":(\d+)/);
        if (usageMatch) outputTokens = parseInt(usageMatch[1]);
        const inputMatch = chunk.match(/"input_tokens":(\d+)/);
        if (inputMatch) inputTokens = parseInt(inputMatch[1]);
      }
      res.end();

      const costUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015);
      await logEvent({
        mode: 'proxy-cloud-stream',
        reason,
        tokens: { input: inputTokens, output: outputTokens },
        cost: costUsd,
        ms: Date.now() - startMs,
      });

    } else {
      // Non-streaming JSON response
      const data = await upstreamResp.json();
      const usage = data.usage || {};
      const inp = usage.input_tokens  || usage.prompt_tokens    || 0;
      const out = usage.output_tokens || usage.completion_tokens || 0;
      const costUsd = (inp * 0.000003) + (out * 0.000015);

      await logEvent({
        mode: 'proxy-cloud',
        reason,
        tokens: { input: inp, output: out },
        cost: costUsd,
        ms: Date.now() - startMs,
      });

      res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }

  } catch (err) {
    await logEvent({ mode: 'proxy-forward-error', error: err.message });
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `IMCP proxy forward failed: ${err.message}` } }));
  }
}

// Main request handler
async function handleRequest(req, res) {
  const startMs = Date.now();
  const apiType = detectApiType(req.url);
  const upstream = apiType === 'openai' ? UPSTREAM_GPT : UPSTREAM_CLAUDE;

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'imcp-proxy=✓', version: '0.2', port: PROXY_PORT }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const body = await readBody(req);
  const streaming = wantsStreaming(body);

  const message = extractMessage(body, apiType);

  // Strip OpenClaw's "Sender (untrusted metadata)" wrapper
  // Real user text starts after the closing ``` of the JSON block
  function stripOpenClawEnvelope(msg) {
    if (!msg) return null;
    // If it starts with "Sender (untrusted metadata)", extract the actual content
    if (msg.startsWith('Sender (untrusted metadata)')) {
      // Find content after the metadata JSON block
      const afterBlock = msg.indexOf('```\n');
      if (afterBlock !== -1) {
        const stripped = msg.slice(afterBlock + 4).trim();
        return stripped || null;
      }
      return null; // Can't extract — forward to cloud
    }
    return msg;
  }

  const classifyMessage = stripOpenClawEnvelope(message);

  // Can't classify — forward immediately
  if (!classifyMessage) {
    await forwardAndRespond(upstream, req, res, body, startMs, 'unclassifiable');
    return;
  }

  const tier = await classify(classifyMessage);

  await logEvent({
    mode: 'proxy-classify',
    tier: tier.level,
    reason: tier.reason,
    streaming,
    message: message.slice(0, 100),
    api: apiType,
  });

  // Tier 3 or ! — forward to cloud, preserve streaming
  if (tier.level === 3 || tier.level === '!') {
    await forwardAndRespond(upstream, req, res, body, startMs, `tier=${tier.level}`);
    return;
  }

  // Tier 0-2 — handle locally
  try {
    const result = await runLocal(message, tier);

    if (result.escalate) {
      await logEvent({ mode: 'proxy-escalate', reason: result.imcp, tier: tier.level });
      await forwardAndRespond(upstream, req, res, body, startMs, 'local-escalated');
      return;
    }

    await logEvent({
      mode: 'proxy-local',
      tier: tier.level,
      model: result.model,
      streaming,
      cost: 0,
      ms: Date.now() - startMs,
      imcp: result.imcp,
    });

    // Respond in streaming or JSON depending on what OpenClaw asked for
    if (streaming) {
      if (apiType === 'openai') {
        streamOpenAILocal(res, result.imcp, result.model);
      } else {
        streamAnthropicLocal(res, result.imcp, result.model);
      }
    } else {
      const responseBody = apiType === 'openai'
        ? buildOpenAIResponse(result.imcp, result.model)
        : buildAnthropicResponse(result.imcp, result.model);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    }

  } catch (err) {
    await logEvent({ mode: 'proxy-error', error: err.message, fallback: 'cloud' });
    await forwardAndRespond(upstream, req, res, body, startMs, 'local-error-fallback');
  }
}

// Start server
const server = createServer(handleRequest);
server.listen(PROXY_PORT, '127.0.0.1', () => {
  process.stdout.write(`proxy=✓ v0.2 port=${PROXY_PORT} | SSE streaming supported. Ready.\n`);
});

server.on('error', (err) => {
  process.stderr.write(`proxy=✗ ! | ${err.message}\n`);
  process.exit(1);
});
