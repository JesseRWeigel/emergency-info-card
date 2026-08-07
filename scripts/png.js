// A PNG reader, enough of one to read pixels out of what Chrome writes.
//
// Why this exists rather than a dependency: the lock-screen claim is that the card sits clear
// of the clock, in the image the user actually sets as a wallpaper. Measuring the HTML proves
// the layout; reading the pixels proves the capture. Chrome's --screenshot can capture at a
// different size than it laid out, so the file is the only thing that settles it.
//
// Scope is deliberately narrow: 8 bit RGB or RGBA, non interlaced, which is what Chrome emits.
// Anything else throws rather than guessing, because a decoder that quietly mis-reads pixels
// would make every check below it meaningless.

import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode to { width, height, channels, data } where data is one byte per channel per pixel. */
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG: the signature is wrong');
  }
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12]
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  if (header.bitDepth !== 8) throw new Error(`PNG bit depth ${header.bitDepth} is not supported`);
  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = header.colorType === 2 ? 3 : header.colorType === 6 ? 4 : null;
  if (channels === null) {
    throw new Error(`PNG colour type ${header.colorType} is not supported, only 2 (RGB) and 6 (RGBA)`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const expected = (stride + 1) * header.height;
  if (raw.length < expected) {
    throw new Error(`PNG data is ${raw.length} bytes, expected at least ${expected}`);
  }

  const out = Buffer.alloc(stride * header.height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unknown PNG filter type ${filter} on row ${y}`);
      cur[x] = value & 0xff;
    }
    prev = cur;
  }

  return { width: header.width, height: header.height, channels, data: out };
}

/** The pixel at (x, y) as [r, g, b]. */
export function pixelAt(image, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
    throw new Error(`pixel (${px}, ${py}) is outside a ${image.width}x${image.height} image`);
  }
  const at = (py * image.width + px) * image.channels;
  return [image.data[at], image.data[at + 1], image.data[at + 2]];
}

/** True when two colours are within `slack` on every channel. */
export function near(a, b, slack = 6) {
  return Math.abs(a[0] - b[0]) <= slack
    && Math.abs(a[1] - b[1]) <= slack
    && Math.abs(a[2] - b[2]) <= slack;
}

/** Cut a rectangle out of a decoded image. */
export function cropPng(image, width, height) {
  if (width > image.width || height > image.height) {
    throw new Error(`cannot crop a ${image.width}x${image.height} image to ${width}x${height}`);
  }
  const out = Buffer.alloc(width * height * image.channels);
  for (let y = 0; y < height; y += 1) {
    image.data.copy(out, y * width * image.channels,
      y * image.width * image.channels,
      y * image.width * image.channels + width * image.channels);
  }
  return { width, height, channels: image.channels, data: out };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Encode back to a PNG. Filter type 0 on every row, which is fine for what this is used for. */
export function encodePng(image) {
  const stride = image.width * image.channels;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = image.channels === 4 ? 6 : 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];
