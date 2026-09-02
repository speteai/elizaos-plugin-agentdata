#!/usr/bin/env node
/**
 * Do the prices this plugin quotes match what the service actually charges?
 *
 * The plugin states a price in prose, inside each action's description, where an
 * agent reads it and budgets against it. Published 1.0.0 quoted $0.002 for four
 * endpoints that had moved to $0.003 and $0.005, and every one of the eight rows
 * in the README table was wrong. An agent budgeting from that catalogue would
 * have been short on each call. A wrong price in a machine-read catalogue is a
 * broken contract, not a typo.
 *
 * Run before publishing. Exits non-zero on any mismatch.
 */
import fs from 'node:fs';

const BASE = process.env.AGENTDATA_BASE_URL || 'https://agentdata-api.com';
const src = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');

// Split on the action-name markers rather than searching within a fixed window.
// A window wide enough to reach a distant callEndpoint is also wide enough for an
// action with no endpoint of its own to borrow the next action's — silently.
const blocks = src.split(/name:\s*'([A-Z_]+)'/).slice(1);
const actions = new Map();
for (let i = 0; i < blocks.length; i += 2) {
  const name = blocks[i];
  const body = blocks[i + 1] || '';
  if (actions.has(name)) continue;                       // examples repeat the name
  const endpoint = body.match(/callEndpoint\(runtime,\s*[`']([^`'?]+)/)?.[1] ?? null;
  const price = body.match(/Costs \$([0-9.]+) USDC/)?.[1] ?? null;
  actions.set(name, { endpoint, price: price ? `$${price}` : null });
}
if (!actions.size) {
  console.error('no actions found — the parser and index.js have drifted apart');
  process.exit(1);
}

const res = await fetch(`${BASE}/llms.txt`);
if (!res.ok) {
  console.error(`cannot read the live catalogue: HTTP ${res.status}`);
  process.exit(1);
}
const live = {};
for (const line of (await res.text()).split('\n')) {
  const hit = line.match(/^- (?:GET|POST) (\/api\/[a-z0-9/-]+) \(\$([0-9.]+)\)/);
  if (hit) live[hit[1]] = `$${hit[2]}`;
}

let bad = 0;
let checked = 0;
const expected = (endpoint) => live[endpoint] ?? null;

for (const [name, { endpoint, price }] of actions) {
  if (!price) continue;                                   // free actions state no price
  checked += 1;
  const actual = expected(endpoint);
  if (actual === price) continue;
  bad += 1;
  console.error(`  index.js ${name} (${endpoint}): says ${price}, service charges ${actual || '(endpoint not served)'}`);
}

// The README table is what a human reads before installing. It drifted further
// than the code did, so it is checked against the same source of truth.
for (const [, name, price] of readme.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(free|\$[0-9.]+)\s*\|/gm)) {
  const action = actions.get(name);
  if (!action) {
    bad += 1;
    console.error(`  README lists ${name}, which index.js does not define`);
    continue;
  }
  checked += 1;
  if (price === 'free') {
    if (action.price) {
      bad += 1;
      console.error(`  README calls ${name} free, but index.js quotes ${action.price}`);
    }
    continue;
  }
  const actual = expected(action.endpoint);
  if (actual === price) continue;
  bad += 1;
  console.error(`  README ${name} (${action.endpoint}): table says ${price}, service charges ${actual || '(endpoint not served)'}`);
}

if (bad) {
  console.error(`\n${bad} discrepancy(ies) — fix before publishing.`);
  process.exit(1);
}
console.log(`Catalogue matches the service: ${actions.size} actions, ${checked} price claims checked.`);
