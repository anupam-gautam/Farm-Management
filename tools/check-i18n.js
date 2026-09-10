// i18n dictionary parity test — run with: node tools/check-i18n.js
// Fails (exit 1) if:
//   1. en and ne have different key sets
//   2. any string is empty
//   3. {param} placeholders differ between languages for the same key
//   4. any key contains raw HTML (strings must stay markup-free)

import { DICTIONARY } from '../src/i18n-dictionary.js';

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );
}

function params(str) {
  return [...str.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
}

const en = DICTIONARY.en;
const ne = DICTIONARY.ne;
const enKeys = flatten(en);
const neKeys = flatten(ne);

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };

// 1. Key-set parity
const enSet = new Set(enKeys);
const neSet = new Set(neKeys);
for (const k of enKeys) if (!neSet.has(k)) fail(`missing in ne: ${k}`);
for (const k of neKeys) if (!enSet.has(k)) fail(`missing in en: ${k}`);

// 2–4. Per-key checks
function get(obj, dotKey) {
  return dotKey.split('.').reduce((node, part) => node?.[part], obj);
}

for (const k of enKeys) {
  const enVal = get(en, k);
  const neVal = get(ne, k);
  if (typeof enVal !== 'string' || enVal.trim() === '') fail(`empty en string: ${k}`);
  if (typeof neVal === 'string') {
    if (neVal.trim() === '') fail(`empty ne string: ${k}`);
    if (params(enVal) !== params(neVal))
      fail(`param mismatch on ${k}: en{${params(enVal)}} vs ne{${params(neVal)}}`);
    if (/<[a-z]+[\s>]/i.test(enVal) || /<[a-z]+[\s>]/i.test(neVal))
      fail(`raw HTML in string: ${k}`);
  }
}

console.log(`Checked ${enKeys.length} keys (en) vs ${neKeys.length} keys (ne)`);
if (failures) {
  console.error(`\n${failures} problem(s) found`);
  process.exit(1);
}
console.log('i18n dictionary: ALL CHECKS PASSED');
