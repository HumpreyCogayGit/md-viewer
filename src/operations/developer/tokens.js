import { bytesToHex, hexToBytes, utf8Decode } from '../bytes.js';
import { markdownTable, operationFactory } from '../define.js';
import { base32Decode, base64Decode } from '../encoding/codecs.js';
import { formatIso, relativeTime } from '../dates/index.js';

// ---------------------------------------------------------------- JWT
const TIME_CLAIMS = { exp: 'Expires', iat: 'Issued at', nbf: 'Not before', auth_time: 'Authenticated at' };

export function decodeJwt(token) {
  const parts = String(token)
    .trim()
    .replace(/^Bearer\s+/i, '')
    .split('.');
  if (parts.length < 2 || parts.length > 3)
    throw new Error('A JWT has three dot-separated parts (header.payload.signature).');
  const decodePart = (part, label) => {
    try {
      return JSON.parse(utf8Decode(base64Decode(part, { urlSafe: true }), { fatal: true }));
    } catch {
      throw new Error(`The JWT ${label} is not Base64URL-encoded JSON.`);
    }
  };
  return {
    header: decodePart(parts[0], 'header'),
    payload: decodePart(parts[1], 'payload'),
    signature: parts[2] || '',
  };
}

export function inspectJwt(token, { now = new Date() } = {}) {
  const { header, payload, signature } = decodeJwt(token);
  const timeRows = Object.entries(TIME_CLAIMS)
    .filter(([claim]) => typeof payload[claim] === 'number')
    .map(([claim, label]) => {
      const date = new Date(payload[claim] * 1000);
      let status = relativeTime(date, now);
      if (claim === 'exp')
        status = date < now ? `⚠️ expired ${relativeTime(date, now)}` : `valid, expires ${relativeTime(date, now)}`;
      if (claim === 'nbf' && date > now) status = `⚠️ not yet valid (${relativeTime(date, now)})`;
      return [`${claim} (${label})`, formatIso(date), status];
    });
  return [
    '> ⚠️ Decoded only. The signature has **not** been verified, so these claims cannot be trusted.',
    '',
    `**Header** (alg: \`${header.alg ?? 'none'}\`${header.alg === 'none' ? ' — unsigned token' : ''})`,
    '',
    '```json',
    JSON.stringify(header, null, 2),
    '```',
    '',
    '**Payload**',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    ...(timeRows.length ? ['', '**Time claims**', '', markdownTable(['Claim', 'UTC', 'Status'], timeRows)] : []),
    '',
    `**Signature:** ${signature ? `${signature.length} characters (not verified)` : 'missing'}`,
  ].join('\n');
}

// ---------------------------------------------------------------- UUID
const UUID_PATTERN = /^\{?(urn:uuid:)?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

const formatUuidBytes = (bytes) => bytesToHex(bytes).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

export function uuidV4() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuidBytes(bytes);
}

export function uuidV7(now = Date.now()) {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuidBytes(bytes);
}

export function parseUuid(text) {
  const match = UUID_PATTERN.exec(String(text).trim());
  if (!match) return null;
  const hex = match.slice(2).join('').toLowerCase();
  return { hex, canonical: hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') };
}

export function analyzeUuid(text) {
  const parsed = parseUuid(text);
  if (!parsed) return { valid: false };
  const { hex, canonical } = parsed;
  const version = parseInt(hex[12], 16);
  const variantBits = parseInt(hex[16], 16);
  const variant =
    variantBits >= 0xe
      ? 'Reserved (future)'
      : variantBits >= 0xc
        ? 'Microsoft (GUID)'
        : variantBits >= 0x8
          ? 'RFC 9562'
          : 'NCS (legacy)';
  let timestamp;
  if (version === 7) timestamp = new Date(parseInt(hex.slice(0, 12), 16));
  if (version === 1) {
    const ticks =
      (BigInt(`0x${hex.slice(13, 16)}`) << 48n) |
      (BigInt(`0x${hex.slice(8, 12)}`) << 32n) |
      BigInt(`0x${hex.slice(0, 8)}`);
    timestamp = new Date(Number((ticks - 122192928000000000n) / 10000n));
  }
  const nil = /^0+$/.test(hex);
  const max = /^f+$/.test(hex);
  return {
    valid: true,
    canonical,
    version: nil || max ? 0 : version,
    variant: nil ? 'Nil UUID' : max ? 'Max UUID' : variant,
    timestamp,
  };
}

export function formatUuid(text, { style = 'canonical' } = {}) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      const parsed = parseUuid(line);
      if (!parsed) throw new Error(`Not a UUID: ${line.trim()}`);
      switch (style) {
        case 'upper':
          return parsed.canonical.toUpperCase();
        case 'compact':
          return parsed.hex;
        case 'braces':
          return `{${parsed.canonical.toUpperCase()}}`;
        case 'urn':
          return `urn:uuid:${parsed.canonical}`;
        case 'base64':
          return btoa(String.fromCharCode(...hexToBytes(parsed.hex)));
        default:
          return parsed.canonical;
      }
    })
    .join('\n');
}

// ---------------------------------------------------------------- MongoDB ObjectID
export function inspectObjectId(text) {
  const id = String(text)
    .trim()
    .replace(/^ObjectId\(["']?|["']?\)$/g, '');
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new Error('An ObjectID is 24 hexadecimal characters.');
  const seconds = parseInt(id.slice(0, 8), 16);
  return markdownTable(
    ['Field', 'Value'],
    [
      ['Timestamp', formatIso(new Date(seconds * 1000))],
      ['Unix seconds', seconds],
      ['Random/machine', id.slice(8, 18)],
      ['Counter', parseInt(id.slice(18), 16)],
    ],
  );
}

// ---------------------------------------------------------------- HOTP / TOTP (RFC 4226 / 6238)
export async function hotp(secretBytes, counter, { digits = 6, algorithm = 'SHA-1' } = {}) {
  const counterBytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i -= 1) {
    counterBytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  const key = await globalThis.crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: algorithm }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export async function totp(secretBytes, { time = Date.now(), period = 30, digits = 6, algorithm = 'SHA-1' } = {}) {
  return hotp(secretBytes, Math.floor(time / 1000 / period), { digits, algorithm });
}

function decodeSecret(text) {
  const value = String(text).trim();
  const otpauth = /^otpauth:\/\//i.test(value) ? new URL(value).searchParams.get('secret') : null;
  return base32Decode((otpauth || value).replace(/\s+/g, ''));
}

// ---------------------------------------------------------------- Operations
const tokens = operationFactory('Tokens & IDs');

export const tokenOperations = [
  tokens({
    id: 'jwt.decode',
    name: 'Decode JWT',
    description: 'Show a JSON Web Token’s header, claims and timestamp claims. Does NOT verify the signature.',
    aliases: ['jwt', 'bearer token', 'id token'],
    outputMode: 'report',
    notes: 'Decoding does not verify the signature.',
    detect: (text) =>
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text.trim()) && text.trim().startsWith('eyJ'),
    run: (input) => inspectJwt(input),
  }),
  tokens({
    id: 'uuid.inspect',
    name: 'Validate / Inspect UUID',
    description: 'Validate UUIDs (one per line) and show version, variant and embedded timestamp.',
    aliases: ['guid', 'uuid version', 'uuid timestamp'],
    outputMode: 'report',
    run: (input) =>
      markdownTable(
        ['UUID', 'Valid', 'Version', 'Variant', 'Timestamp'],
        input
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => {
            const info = analyzeUuid(line);
            return info.valid
              ? [
                  info.canonical,
                  '✅',
                  info.version || '—',
                  info.variant,
                  info.timestamp ? formatIso(info.timestamp) : '',
                ]
              : [line.trim(), '❌', '', '', ''];
          }),
      ),
  }),
  tokens({
    id: 'uuid.format',
    name: 'Reformat UUID',
    description: 'Convert UUIDs between canonical, upper case, compact, {braced}, URN and Base64 forms.',
    aliases: ['guid', 'uuid format'],
    options: [
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 'canonical',
        choices: [
          { value: 'canonical', label: 'lower-case canonical' },
          { value: 'upper', label: 'UPPER-CASE' },
          { value: 'compact', label: 'No dashes' },
          { value: 'braces', label: '{Microsoft GUID}' },
          { value: 'urn', label: 'urn:uuid:' },
          { value: 'base64', label: 'Base64 (16 bytes)' },
        ],
      },
    ],
    run: formatUuid,
  }),
  tokens({
    id: 'objectid.inspect',
    name: 'Inspect MongoDB ObjectID',
    description: 'Show the creation time embedded in an ObjectID.',
    aliases: ['mongo', 'bson id'],
    outputMode: 'report',
    run: inspectObjectId,
  }),
  tokens({
    id: 'otp.totp',
    name: 'TOTP / HOTP Code',
    description: 'Generate a one-time code from a Base32 secret or otpauth:// URI (computed locally).',
    aliases: ['2fa', 'mfa', 'authenticator', 'one time password'],
    outputMode: 'report',
    notes: 'The secret never leaves this browser. Treat secrets as sensitive and avoid saving them in documents.',
    options: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'totp',
        choices: [
          { value: 'totp', label: 'TOTP (time-based)' },
          { value: 'hotp', label: 'HOTP (counter)' },
        ],
      },
      { key: 'counter', label: 'HOTP counter', type: 'number', default: 0, min: 0 },
      { key: 'digits', label: 'Digits', type: 'number', default: 6, min: 6, max: 10 },
      { key: 'period', label: 'TOTP period (s)', type: 'number', default: 30, min: 1 },
      { key: 'algorithm', label: 'Hash', type: 'select', default: 'SHA-1', choices: ['SHA-1', 'SHA-256', 'SHA-512'] },
    ],
    run: async (input, { mode, counter, digits, period, algorithm }) => {
      const secret = decodeSecret(input);
      if (mode === 'hotp')
        return `HOTP (counter ${counter}): **${await hotp(secret, counter, { digits, algorithm })}**`;
      const now = Date.now();
      const remaining = period - (Math.floor(now / 1000) % period);
      return `TOTP: **${await totp(secret, { time: now, period, digits, algorithm })}** (valid for ${remaining}s)`;
    },
  }),
];
