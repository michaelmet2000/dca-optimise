#!/usr/bin/env node
// Génère les icônes de l'app (SVG + PNG 180/192/512) sans dépendance : encodeur PNG minimal avec zlib.
// Motif : 4 barres croissantes (on investit davantage quand le marché baisse) sur fond bleu.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const BG = [0x1f, 0x6f, 0xeb], FG = [0xff, 0xff, 0xff];
// Barres en coordonnées relatives (0..1), dans la zone sûre centrale des icônes « maskable »
const BARS = [0, 1, 2, 3].map(i => ({ x0: 0.27 + i * 0.125, x1: 0.27 + i * 0.125 + 0.085, y1: 0.70, y0: 0.70 - (0.16 + i * 0.1) }));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#1f6feb"/>
${BARS.map(b => `<rect x="${(b.x0 * 100).toFixed(1)}" y="${(b.y0 * 100).toFixed(1)}" width="${((b.x1 - b.x0) * 100).toFixed(1)}" height="${((b.y1 - b.y0) * 100).toFixed(1)}" rx="1.5" fill="#fff"/>`).join('\n')}
</svg>
`;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const SS = 4; // suréchantillonnage pour lisser les bords
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
        if (BARS.some(b => u >= b.x0 && u <= b.x1 && v >= b.y0 && v <= b.y1)) cover++;
      }
      const a = cover / (SS * SS);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 bits, RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(180));
fs.writeFileSync(path.join(OUT, 'icon-192.png'), png(192));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), png(512));
console.log('icônes écrites dans', OUT);
