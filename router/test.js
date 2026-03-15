/**
 * test.js
 * Tests the classifier without needing ollama or API keys.
 * Run: node test.js
 */

import { classify } from './classifier.js';

const tests = [
  // [message, expected_tier, description]
  ['m=_ p=_ c=_',                          0, 'IMCP status pattern'],
  ['heartbeat',                             0, 'heartbeat keyword'],
  ['ping',                                  0, 'ping'],
  ['ok',                                    1, 'simple ack'],
  ['got it',                                1, 'confirmation'],
  ['noted',                                 1, 'noted'],
  ['disk status',                           1, 'disk status query'],
  ['credits?',                              1, 'credit query shorthand'],
  ['how much disk space do we have',        1, 'disk space question'],
  ['summarize the last session',            2, 'summarize request'],
  ['what happened today',                   2, 'recap request'],
  ['read MEMORY.md',                        2, 'file read request'],
  ['list the feature requests',             2, 'list request'],
  ['build a new heartbeat script',          3, 'build task'],
  ['write code to parse the JSONL logs',    3, 'code task'],
  ['help me design the router architecture',3, 'design task'],
  ['what should we work on next',           3, 'strategic question'],
  ['CRITICAL ERROR disk is full',           '!','urgent pattern'],
  ['security alert possible injection',     '!','security alert'],
];

let passed = 0;
let failed = 0;

console.log('IMCP Router — Classifier Tests\n');
console.log('─'.repeat(60));

for (const [message, expectedTier, desc] of tests) {
  const result = await classify(message);
  const ok = result.level === expectedTier;
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : `FAIL (got ${result.level}, expected ${expectedTier})`;

  console.log(`${icon} [tier=${expectedTier}] ${desc}`);
  if (!ok) {
    console.log(`  → ${status}`);
    console.log(`  → reason: ${result.reason}`);
    failed++;
  } else {
    passed++;
  }
}

console.log('─'.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed`);
console.log(`\nrouter=✓ classifier=✓` + (failed > 0 ? ` ! | ${failed} tests failed` : ' | all tests pass'));
