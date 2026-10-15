import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + body.length);
  return out;
}

function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y, width, height);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function mark(x, y, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const d = Math.hypot(x - cx, y - cy) / width;
  const ring = d > 0.28 && d < 0.36;
  const dot = d < 0.08;
  if (ring || dot) return [231, 177, 90, 255];
  return [14, 18, 24, 255];
}

function poster(x, y, width, height) {
  const base = y < height * 0.42 ? [18, 24, 34, 255] : [12, 16, 22, 255];
  const band = Math.abs(y - height * 0.22) < 2 ? [231, 177, 90, 255] : null;
  if (band) return band;
  const cx = width * 0.5;
  const cy = height * 0.18;
  if (Math.hypot(x - cx, y - cy) < width * 0.06) return [158, 182, 255, 255];
  return base;
}

const icons = [
  ["public/alexa/icon-72.png", 72, 72, mark],
  ["public/alexa/icon-64.png", 64, 64, mark],
  ["public/alexa/icon-88.png", 88, 88, mark],
  ["public/alexa/icon-126.png", 126, 126, mark],
  ["public/alexa/icon-180.png", 180, 180, mark],
  ["public/alexa/icon-241.png", 241, 241, mark],
  ["public/alexa/carousel.png", 600, 900, poster],
];

for (const [file, width, height, paint] of icons) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(width, height, paint));
}
