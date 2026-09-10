// Copy @sbmdkl/nepali-date-converter ESM build into vendor/ for browser import.
// Run after npm install: npm run vendor

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(
  root,
  'node_modules/@sbmdkl/nepali-date-converter/dist/@sbmdkl/nepali-date-converter.es.js'
);
const dest = path.join(root, 'vendor/nepali-date-converter.es.js');

const pkg = JSON.parse(
  await readFile(
    path.join(root, 'node_modules/@sbmdkl/nepali-date-converter/package.json'),
    'utf8'
  )
);

const body = await readFile(src, 'utf8');
const header = `// @sbmdkl/nepali-date-converter v${pkg.version} — ${pkg.license} licence
// Vendored for offline/browser use. Regenerate: npm run vendor
`;

await mkdir(path.dirname(dest), { recursive: true });
await writeFile(dest, header + body);
console.log(`Vendored nepali-date-converter v${pkg.version} → vendor/nepali-date-converter.es.js`);
