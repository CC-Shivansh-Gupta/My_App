// Generates the app icons (SVG + PNGs) without any dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../app/icons/', import.meta.url);
const TOP = [0x3a, 0x8b, 0xe8];
const BOTTOM = [0x1c, 0x5c, 0xab];
const CHECK = [[0.30, 0.53], [0.445, 0.67], [0.72, 0.38]];
const STROKE = 0.095;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a8be8"/><stop offset="1" stop-color="#1c5cab"/></linearGradient></defs>
<rect width="512" height="512" rx="115" fill="url(#g)"/>
<polyline points="${CHECK.map(([x, y]) => `${x * 512},${y * 512}`).join(' ')}" fill="none" stroke="#fff" stroke-width="${STROKE * 512}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
writeFileSync(new URL('icon.svg', OUT), svg);

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// radius: corner radius as a fraction (0 = full bleed square); scale shrinks the check (maskable safe zone)
function render(size, { radius = 0.225, scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0; let white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (radius && !inRoundRect(u, v, radius)) continue;
          cover++;
          const cu = 0.5 + (u - 0.5) / scale; const cv = 0.5 + (v - 0.5) / scale;
          const d = Math.min(segDist(cu, cv, CHECK[0], CHECK[1]), segDist(cu, cv, CHECK[1], CHECK[2]));
          if (d <= STROKE / 2) white++;
        }
      }
      const i = (y * size + x) * 4;
      const t = y / (size - 1);
      const n = SS * SS;
      const w = cover ? white / cover : 0;
      for (let c = 0; c < 3; c++) {
        const bg = TOP[c] + (BOTTOM[c] - TOP[c]) * t;
        px[i + c] = Math.round(bg + (255 - bg) * w);
      }
      px[i + 3] = Math.round((cover / n) * 255);
    }
  }
  return png(size, size, px);
}

function crc32(buf) {
  let c; let crc = 0xffffffff;
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

function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(new URL('icon-192.png', OUT), render(192));
writeFileSync(new URL('icon-512.png', OUT), render(512));
writeFileSync(new URL('icon-maskable-512.png', OUT), render(512, { radius: 0, scale: 0.8 }));
writeFileSync(new URL('apple-touch-icon.png', OUT), render(180, { radius: 0 }));
console.log('Icons written to app/icons/');
