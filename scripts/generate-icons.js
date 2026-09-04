#!/usr/bin/env node
/* =========================================================
   Draws the Ledger seal and writes it out as PNG.
   Hand-rolled encoder so the project keeps zero dependencies.
   Run with: npm run icons
   ========================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG encoding ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of size*size*4 */
function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- drawing ---------------- */
const INK = [0x12, 0x15, 0x1c];
const GOLD = [0xd4, 0xa9, 0x4a];

/** Centreline of the S, in units where the seal ring sits at radius 1. */
const S_PATH = [
  [0.30, -0.46], [0.09, -0.56], [-0.17, -0.47], [-0.27, -0.25],
  [-0.13, -0.06], [0.11, 0.03], [0.25, 0.16], [0.27, 0.37],
  [0.09, 0.53], [-0.17, 0.52], [-0.31, 0.41]
];

/** Catmull-Rom through the control points, so the stroke reads as one curve. */
function sampleCurve(points, per = 48) {
  const out = [];
  const pt = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [pt(i - 1), pt(i), pt(i + 1), pt(i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function drawIcon(size, { maskable = false } = {}) {
  const rgba = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  // Maskable icons get squeezed by the launcher's mask, so the emblem
  // sits inside the safe zone and the background runs edge to edge.
  const emblemR = size * (maskable ? 0.30 : 0.40);
  const corner = maskable ? 0 : size * 0.22;

  const coverage = new Float32Array(size * size); // gold coverage 0..1

  /* stroke the S by stamping soft discs along the curve */
  const strokeR = emblemR * 0.115;
  for (const [ux, uy] of sampleCurve(S_PATH)) {
    const px = cx + ux * emblemR, py = cy + uy * emblemR;
    const x0 = Math.max(0, Math.floor(px - strokeR - 1)), x1 = Math.min(size - 1, Math.ceil(px + strokeR + 1));
    const y0 = Math.max(0, Math.floor(py - strokeR - 1)), y1 = Math.min(size - 1, Math.ceil(py + strokeR + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        const c = Math.max(0, Math.min(1, strokeR + 0.5 - d));
        const i = y * size + x;
        if (c > coverage[i]) coverage[i] = c;
      }
    }
  }

  /* the ring, plus the rounded-square backdrop */
  const ringR = emblemR * 0.97, ringHalf = emblemR * 0.055;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const ring = Math.max(0, Math.min(1, ringHalf + 0.5 - Math.abs(Math.hypot(dx, dy) - ringR)));
      const gold = Math.max(coverage[i], ring);

      // rounded-square alpha (a plain square when maskable)
      let alpha = 1;
      if (corner > 0) {
        const qx = Math.abs(dx) - (size / 2 - corner);
        const qy = Math.abs(dy) - (size / 2 - corner);
        const d = (qx > 0 && qy > 0) ? Math.hypot(qx, qy) - corner : Math.max(qx, qy) - corner;
        alpha = Math.max(0, Math.min(1, 0.5 - d));
      }

      const o = i * 4;
      rgba[o]     = Math.round(INK[0] + (GOLD[0] - INK[0]) * gold);
      rgba[o + 1] = Math.round(INK[1] + (GOLD[1] - INK[1]) * gold);
      rgba[o + 2] = Math.round(INK[2] + (GOLD[2] - INK[2]) * gold);
      rgba[o + 3] = Math.round(255 * alpha);
    }
  }
  return encodePNG(size, rgba);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }]
];
for (const [name, size, opts] of targets) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, drawIcon(size, opts));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}×${size})`);
}
