// Generates PWA icon PNGs (no dependencies). Run: node tools/generate-icons.js

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Simple leaf shape in the centre — readable at small sizes. */
function isLeaf(x, y, size) {
  const cx = size / 2;
  const cy = size * 0.46;
  const nx = (x - cx) / (size * 0.2);
  const ny = (y - cy) / (size * 0.32);
  return nx * nx + ny * ny < 1;
}

function makePng(size, { maskable = false } = {}) {
  const rows = [];
  const inset = maskable ? Math.round(size * 0.08) : 0;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const i = 1 + x * 4;
      const inSafe = x >= inset && x < size - inset && y >= inset && y < size - inset;
      if (isLeaf(x, y, size)) {
        row[i] = 0xfe; row[i + 1] = 0xfc; row[i + 2] = 0xe8; row[i + 3] = 255; // cream leaf
      } else if (!maskable || inSafe) {
        row[i] = 0x14; row[i + 1] = 0x53; row[i + 2] = 0x2d; row[i + 3] = 255; // farm green
      } else {
        row[i] = row[i + 1] = row[i + 2] = row[i + 3] = 0;
      }
    }
    rows.push(row);
  }
  const compressed = deflateSync(Buffer.concat(rows));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];

for (const [name, size, opts] of icons) {
  writeFileSync(path.join(outDir, name), makePng(size, opts));
}
console.log(`Generated ${icons.length} icons in icons/`);
