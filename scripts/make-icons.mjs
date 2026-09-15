// ساخت آیکون‌های PWA بدون هیچ وابستگی خارجی.
// آیکون به‌صورت رویه‌ای با SDF رندر و به PNG کدگذاری می‌شود تا همیشه قابل بازتولید باشد.
// اجرا: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

/* ------------------------------ ابزارهای رنگ ------------------------------ */
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const BG = hex("#05060f");
const PANEL = hex("#0b1b33");
const CYAN = hex("#22d3ee");
const TEAL = hex("#0e7490");
const RED = hex("#ff3d6e");

/* ------------------------------ توابع فاصله ------------------------------ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const len = (x, y) => Math.hypot(x, y);

/** فاصله تا جعبه‌ی گوشه‌گرد (مرکز در مبدأ) */
function sdRoundBox(x, y, bx, by, r) {
  const qx = Math.abs(x) - (bx - r);
  const qy = Math.abs(y) - (by - r);
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** فاصله تا پاره‌خط */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return len(pax - bax * h, pay - bay * h);
}

/** شش‌ضلعی منتظم با شعاع R — فاصله تا لبه‌ها */
function sdHexRing(x, y, R, width) {
  let d = Infinity;
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI / 3) * i - Math.PI / 2;
    const a1 = (Math.PI / 3) * (i + 1) - Math.PI / 2;
    d = Math.min(d, sdSegment(x, y, Math.cos(a0) * R, Math.sin(a0) * R, Math.cos(a1) * R, Math.sin(a1) * R));
  }
  return d - width / 2;
}

/** شش‌ضلعی توپر (تقریب با نیم‌صفحه‌ها) */
function sdHexFill(x, y, R) {
  let d = -Infinity;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    d = Math.max(d, x * Math.cos(a) + y * Math.sin(a) - R * Math.cos(Math.PI / 6));
  }
  return d;
}

/* -------------------------------- رندر ---------------------------------- */
function shade(x, y) {
  // لایه‌ها از زیر به رو
  const layers = [
    // پس‌زمینه
    { d: sdRoundBox(x, y, 256, 256, 96), color: BG, fill: true },
    // قاب نئونی
    { d: Math.abs(sdRoundBox(x, y, 242, 242, 84)) - 5, color: CYAN, fill: true },
    // شش‌ضلعی بیرونی
    { d: sdHexRing(x, y, 170, 14), color: TEAL, fill: true },
    // صفحه‌ی داخلی
    { d: sdHexFill(x, y, 132), color: PANEL, fill: true },
    // بازوهای نشانه‌روی
    { d: sdSegment(x, y, 0, -104, 0, -62) - 8, color: CYAN, fill: true },
    { d: sdSegment(x, y, 0, 104, 0, 62) - 8, color: CYAN, fill: true },
    { d: sdSegment(x, y, -104, 0, -62, 0) - 8, color: CYAN, fill: true },
    { d: sdSegment(x, y, 104, 0, 62, 0) - 8, color: CYAN, fill: true },
    // حلقه‌ی مرکزی
    { d: Math.abs(len(x, y) - 52) - 7, color: CYAN, fill: true },
    // نقطه‌ی مرکزی
    { d: len(x, y) - 16, color: RED, fill: true },
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const l of layers) {
    if (l.d > 0.5) continue;
    const cov = clamp(0.5 - l.d, 0, 1);
    if (cov <= 0) continue;
    // ترکیب آلفا (source-over)
    const outA = cov + a * (1 - cov);
    r = (l.color[0] * cov + r * a * (1 - cov)) / outA;
    g = (l.color[1] * cov + g * a * (1 - cov)) / outA;
    b = (l.color[2] * cov + b * a * (1 - cov)) / outA;
    a = outA;
  }
  return [r, g, b, a];
}

/** رندر با اَبَرنمونه‌گیری برای لبه‌های صاف */
function render(size, { scale = 1, opaque = false } = {}) {
  const ss = 4; // اَبَرنمونه در هر محور
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // جمع ضرب‌شده (premultiplied) روی زیرنمونه‌ها، بعد میانگین
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = ((x + (sx + 0.5) / ss) / size - 0.5) * 512 * scale;
          const ny = ((y + (sy + 0.5) / ss) / size - 0.5) * 512 * scale;
          const c = shade(nx, ny);
          pr += c[0] * c[3];
          pg += c[1] * c[3];
          pb += c[2] * c[3];
          a += c[3];
        }
      }
      const n = ss * ss;
      a /= n;
      const r = a > 0 ? pr / (a * n) : 0;
      const g = a > 0 ? pg / (a * n) : 0;
      const b = a > 0 ? pb / (a * n) : 0;
      const i = (y * size + x) * 4;
      if (opaque) {
        // آیکون‌های اپل/ماسک‌شدنی پس‌زمینه‌ی مات می‌خواهند
        const inv = 1 - a;
        px[i] = r * a + BG[0] * inv;
        px[i + 1] = g * a + BG[1] * inv;
        px[i + 2] = b * a + BG[2] * inv;
        px[i + 3] = 255;
      } else {
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = a * 255;
      }
    }
  }
  return px;
}

/* ------------------------------ کدگذاری PNG ------------------------------ */
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
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // فیلتر None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // بیت بر کانال
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const jobs = [
  ["icon-192.png", 192, { scale: 1, opaque: false }],
  ["icon-512.png", 512, { scale: 1, opaque: false }],
  ["maskable-512.png", 512, { scale: 1.25, opaque: true }],
  ["apple-touch-icon.png", 180, { scale: 1.1, opaque: true }],
  ["favicon-32.png", 32, { scale: 1, opaque: false }],
];

for (const [name, size, opts] of jobs) {
  const png = encodePng(size, render(size, opts));
  writeFileSync(join(OUT, name), png);
  console.log(`✓ ${name} (${size}×${size}, ${png.length} bytes)`);
}
