/**
 * Small files made in code, so the example needs nothing on disk.
 */
import crypto from 'crypto';
import zlib from 'zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A real RGB PNG (a colour gradient) that image transforms can work on. */
export function makePng(width = 64, height = 48): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      raw[i] = Math.round((x / (width - 1)) * 255);
      raw[i + 1] = Math.round((y / (height - 1)) * 255);
      raw[i + 2] = 160;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Width and height of a PNG, or null when the bytes are not a PNG. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** A minimal valid one-page PDF. */
export function makePdf(text = 'Rivium Storage example'): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
    'utf8',
  );
}

/** A tiny fake Windows program: just the "MZ" header. Harmless, but it is an executable by name and by content. */
export function makeFakeExe(): Buffer {
  const buf = Buffer.alloc(64);
  buf.write('MZ', 0, 'ascii');
  return buf;
}

/** HTML bytes. Uploaded with the type image/png, the server sees the real content and refuses it in an images-only bucket. */
export function makeHtml(): Buffer {
  return Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>', 'utf8');
}

/** n bytes that start like a PNG (only for the size check: it is refused before anything looks at the content). */
export function makeBlob(n: number): Buffer {
  const buf = Buffer.alloc(n, 0x41);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return buf;
}

/**
 * A real RGB PNG of random-noise pixels, for watching upload progress on a larger file. It is a real
 * image/png, so buckets that allow only images accept it (random bytes would be application/octet-stream).
 * Deflate level 0 ("stored", noise would not compress anyway), so it is about width x height x 3 bytes:
 * 1300x1300 is ~4.8 MB.
 */
export function makeNoisePng(width = 1300, height = 1300): Buffer {
  const rowBytes = width * 3 + 1;
  const raw = crypto.randomBytes(rowBytes * height);
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0; // filter byte "none" at the start of every row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
