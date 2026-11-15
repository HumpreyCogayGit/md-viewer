import { bytesToHex, toBytes } from '../bytes.js';
import { markdownTable, operationFactory } from '../define.js';
import { base64Encode } from '../encoding/codecs.js';

const ONE_WAY_NOTE = 'Hashes are one-way: they cannot be decoded back to the input.';
const op = operationFactory('Hashing', { inputType: 'bytes', outputMode: 'report', notes: ONE_WAY_NOTE });

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Web Crypto is not available in this browser (a secure https:// context is required).');
  return api;
}

export async function digest(algorithm, input) {
  return new Uint8Array(await subtle().digest(algorithm, toBytes(input)));
}

export async function hmac(algorithm, key, input) {
  const cryptoKey = await subtle().importKey('raw', toBytes(key), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', cryptoKey, toBytes(input)));
}

// ---------------------------------------------------------------- MD5 (RFC 1321) — compatibility only, insecure
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input) {
  const bytes = toBytes(input);
  const length = bytes.length;
  const paddedLength = (((length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, (length * 8) >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor((length * 8) / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const m = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
      b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
      a = temp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word, true));
  return out;
}

// ---------------------------------------------------------------- Checksums
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of toBytes(input)) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function adler32(input) {
  let a = 1;
  let b = 0;
  for (const byte of toBytes(input)) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const hex32 = (value) => value.toString(16).padStart(8, '0');

// ---------------------------------------------------------------- Hash identification
const HASH_SHAPES = [
  [8, 'hex', ['CRC-32', 'Adler-32']],
  [32, 'hex', ['MD5', 'MD4', 'NTLM']],
  [40, 'hex', ['SHA-1', 'RIPEMD-160']],
  [56, 'hex', ['SHA-224', 'SHA3-224']],
  [64, 'hex', ['SHA-256', 'SHA3-256', 'BLAKE2s-256']],
  [96, 'hex', ['SHA-384', 'SHA3-384']],
  [128, 'hex', ['SHA-512', 'SHA3-512', 'BLAKE2b-512', 'Whirlpool']],
  [24, 'base64', ['MD5 (Base64)']],
  [28, 'base64', ['SHA-1 (Base64)']],
  [44, 'base64', ['SHA-256 (Base64)']],
  [64, 'base64', ['SHA-384 (Base64)']],
  [88, 'base64', ['SHA-512 (Base64)']],
];

export function identifyHash(text) {
  const value = String(text).trim();
  if (/^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)) return ['bcrypt'];
  if (/^\$argon2(id|i|d)\$/.test(value)) return ['Argon2'];
  if (/^\$6\$/.test(value)) return ['SHA-512 crypt'];
  if (/^\$5\$/.test(value)) return ['SHA-256 crypt'];
  if (/^\$1\$/.test(value)) return ['MD5 crypt'];
  if (/^\$scrypt\$|^\$7\$/.test(value)) return ['scrypt'];
  if (/^pbkdf2_sha256\$/.test(value)) return ['PBKDF2-SHA256 (Django)'];
  const isHex = /^[0-9a-f]+$/i.test(value);
  const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  const matches = HASH_SHAPES.filter(
    ([length, alphabet]) => value.length === length && (alphabet === 'hex' ? isHex : isBase64 && !isHex),
  ).flatMap(([, , names]) => names);
  return matches;
}

const SHA_ALGORITHMS = ['SHA-256', 'SHA-384', 'SHA-512'];
const FORMAT_OPTION = {
  key: 'format',
  label: 'Output',
  type: 'select',
  default: 'hex',
  choices: [
    { value: 'hex', label: 'Hex' },
    { value: 'HEX', label: 'Hex (upper)' },
    { value: 'base64', label: 'Base64' },
  ],
};
const formatDigest = (bytes, format) =>
  format === 'base64' ? base64Encode(bytes) : format === 'HEX' ? bytesToHex(bytes).toUpperCase() : bytesToHex(bytes);

export async function allHashes(input) {
  const bytes = toBytes(input);
  const rows = [];
  for (const algorithm of SHA_ALGORITHMS) rows.push([algorithm, bytesToHex(await digest(algorithm, bytes))]);
  rows.push(['SHA-1 ⚠️ insecure', bytesToHex(await digest('SHA-1', bytes))]);
  rows.push(['MD5 ⚠️ insecure', bytesToHex(md5(bytes))]);
  rows.push(['CRC-32', hex32(crc32(bytes))]);
  rows.push(['Adler-32', hex32(adler32(bytes))]);
  return rows;
}

export const hashingOperations = [
  ...SHA_ALGORITHMS.map((algorithm) =>
    op({
      id: `hash.${algorithm.toLowerCase()}`,
      name: algorithm,
      description: `${algorithm} digest of the selection (UTF-8). Computed locally with Web Crypto.`,
      aliases: ['hash', 'digest', 'checksum', algorithm.replace('-', '').toLowerCase()],
      outputMode: 'report',
      options: [FORMAT_OPTION],
      run: async (bytes, { format }) => formatDigest(await digest(algorithm, bytes), format),
    }),
  ),
  op({
    id: 'hash.sha-1',
    name: 'SHA-1 (insecure)',
    description: 'SHA-1 for compatibility only — it is cryptographically broken; do not use for security.',
    aliases: ['sha1', 'hash'],
    insecure: true,
    options: [FORMAT_OPTION],
    run: async (bytes, { format }) => formatDigest(await digest('SHA-1', bytes), format),
  }),
  op({
    id: 'hash.md5',
    name: 'MD5 (insecure)',
    description: 'MD5 for compatibility only — it is cryptographically broken; do not use for security.',
    aliases: ['md5sum', 'hash'],
    insecure: true,
    options: [FORMAT_OPTION],
    run: (bytes, { format }) => formatDigest(md5(bytes), format),
  }),
  op({
    id: 'hash.hmac',
    name: 'HMAC',
    description: 'Keyed HMAC (SHA-256/384/512) via Web Crypto.',
    aliases: ['mac', 'signature', 'hmac-sha256'],
    options: [
      { key: 'key', label: 'Key', type: 'text', default: '' },
      { key: 'algorithm', label: 'Hash', type: 'select', default: 'SHA-256', choices: SHA_ALGORITHMS },
      FORMAT_OPTION,
    ],
    run: async (bytes, { key, algorithm, format }) => formatDigest(await hmac(algorithm, key, bytes), format),
  }),
  op({
    id: 'hash.crc32',
    name: 'CRC-32',
    description: 'CRC-32 (IEEE 802.3) checksum — not a security hash.',
    aliases: ['crc', 'checksum'],
    run: (bytes) => hex32(crc32(bytes)),
  }),
  op({
    id: 'hash.adler32',
    name: 'Adler-32',
    description: 'Adler-32 checksum (zlib) — not a security hash.',
    aliases: ['checksum'],
    run: (bytes) => hex32(adler32(bytes)),
  }),
  op({
    id: 'hash.all',
    name: 'All Hashes',
    description: 'SHA-2, SHA-1, MD5, CRC-32 and Adler-32 of one input as a table.',
    aliases: ['checksums', 'digests'],
    run: async (bytes) => markdownTable(['Algorithm', 'Digest'], await allHashes(bytes)),
  }),
  op({
    id: 'hash.identify',
    name: 'Identify Hash Type',
    description: 'Guess which algorithm produced a hash from its length and alphabet.',
    aliases: ['hash id', 'what hash'],
    inputType: 'text',
    notes: 'Identification is a guess based on shape; several algorithms share the same length.',
    run: (text) => {
      const candidates = identifyHash(text);
      return candidates.length
        ? `Possible algorithms:\n${candidates.map((name) => `- ${name}`).join('\n')}`
        : 'Unknown hash format.';
    },
  }),
];
