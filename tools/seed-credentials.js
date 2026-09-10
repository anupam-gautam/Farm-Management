// Generates data/credentials.seed.json with real PBKDF2-SHA256 hashes.
// Run once: node tools/seed-credentials.js
// Re-running regenerates salts/hashes — only do this before first deployment,
// because the seed only applies to an empty database.

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Must match src/auth.js (client) and tools/check-auth.js exactly.
export const ITERATIONS = 100_000;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;

function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  // Salt must be the DECODED bytes, not the hex text — the browser's
  // WebCrypto path (src/auth.js) decodes hex to bytes before deriving.
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), ITERATIONS, KEY_BYTES, 'sha256').toString('hex');
  return { salt, hash, iterations: ITERATIONS };
}

const now = new Date().toISOString();

const seed = {
  schemaVersion: 1,
  generatedAt: now,
  accounts: [
    {
      username: 'admin',
      role: 'owner',
      display_name: 'Farm Owner',
      must_change_password: true,
      active: true,
      ...hashPassword('farm123'),
    },
    {
      username: 'worker',
      role: 'worker',
      display_name: 'Farm Worker',
      must_change_password: true,
      active: true,
      ...hashPassword('field123'),
    },
  ],
};

mkdirSync(path.join(root, 'data'), { recursive: true });
const out = path.join(root, 'data', 'credentials.seed.json');
writeFileSync(out, JSON.stringify(seed, null, 2) + '\n');
console.log(`Wrote ${out}`);
console.log(`Accounts: ${seed.accounts.map((a) => `${a.username} (${a.role})`).join(', ')}`);
