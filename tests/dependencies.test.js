import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('index.js', root), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

// 1.1.0 imported viem and declared it nowhere. The import is dynamic and only on
// the payment path, so the plugin loaded fine and failed with
// "Cannot find package 'viem'" the first time a user actually tried to pay —
// invisible here, because this repo resolves viem from a sibling project's tree.
test('every package imported at runtime is declared', () => {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const imported = new Set();
  // Static `import ... from 'x'` only at the head of a line, and dynamic
  // `import('x')`. A looser pattern matched the word `from` inside the EIP-712
  // type list ({ name: 'from', type: 'address' }) and reported it as a package.
  const patterns = [
    /^\s*import\s[^'"\n]*\sfrom\s+['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      imported.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  }
  const missing = [...imported].filter((name) => !declared.has(name) && !name.startsWith('node:'));
  assert.deepEqual(missing, [], `imported but not declared: ${missing.join(', ')}`);
});
