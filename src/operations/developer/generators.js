import qrcode from 'qrcode-generator';
import { operationFactory } from '../define.js';
import { formatDate, formatIso } from '../dates/index.js';
import { uuidV4, uuidV7 } from './tokens.js';
import { base64Encode } from '../encoding/codecs.js';

/** Unbiased random integer in [0, max) using Web Crypto (rejection sampling). */
export function secureRandomInt(max) {
  if (max <= 0 || max > 2 ** 32) throw new Error('Invalid range.');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buffer = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buffer);
  while (buffer[0] >= limit);
  return buffer[0] % max;
}

export const CHARSETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  lower: 'abcdefghijklmnopqrstuvwxyz0123456789',
  hex: '0123456789abcdef',
  numeric: '0123456789',
  base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  unambiguous: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',
};
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';

export function randomString(length, charset) {
  const alphabet = Array.from(new Set(Array.from(charset)));
  if (alphabet.length === 0) throw new Error('The character set is empty.');
  return Array.from({ length }, () => alphabet[secureRandomInt(alphabet.length)]).join('');
}

/** Password containing at least one character from each selected class. */
export function generatePassword({ length = 20, upper = true, lower = true, digits = true, symbols = true } = {}) {
  const classes = [
    upper && 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower && 'abcdefghijklmnopqrstuvwxyz',
    digits && '0123456789',
    symbols && SYMBOLS,
  ].filter(Boolean);
  if (classes.length === 0) throw new Error('Select at least one character class.');
  if (length < classes.length) throw new Error(`Length must be at least ${classes.length}.`);
  const chars = classes.map((set) => set[secureRandomInt(set.length)]);
  const all = classes.join('');
  while (chars.length < length) chars.push(all[secureRandomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const LOREM_WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(
    ' ',
  );

export function loremIpsum({ unit = 'paragraphs', count = 3, random = Math.random } = {}) {
  const word = () => LOREM_WORDS[Math.floor(random() * LOREM_WORDS.length)];
  const sentence = (first = false) => {
    const words = first ? ['lorem', 'ipsum', 'dolor', 'sit', 'amet'] : [];
    const length = 6 + Math.floor(random() * 10);
    while (words.length < length) words.push(word());
    const text = words.join(' ');
    return `${text[0].toUpperCase()}${text.slice(1)}.`;
  };
  if (unit === 'words')
    return ['lorem', 'ipsum', ...Array.from({ length: Math.max(0, count - 2) }, word)].slice(0, count).join(' ');
  if (unit === 'sentences') return Array.from({ length: count }, (_, i) => sentence(i === 0)).join(' ');
  return Array.from({ length: count }, (_, p) =>
    Array.from({ length: 4 + Math.floor(random() * 3) }, (_, s) => sentence(p === 0 && s === 0)).join(' '),
  ).join('\n\n');
}

export function qrCodeSvg(text, { errorCorrection = 'M', cellSize = 4, margin = 2 } = {}) {
  const value = String(text);
  if (!value) throw new Error('Select the text to encode first.');
  const qr = qrcode(0, errorCorrection);
  qr.addData(value, 'Byte');
  try {
    qr.make();
  } catch {
    throw new Error('The text is too long for a QR code.');
  }
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

const generate = operationFactory('Generate', { inputType: 'none', outputMode: 'insert' });

export const generatorOperations = [
  generate({
    id: 'generate.uuid',
    name: 'UUID',
    description: 'Insert random UUIDs (v4) or time-ordered UUIDs (v7).',
    aliases: ['guid', 'uuid v4', 'uuid v7', 'unique id'],
    options: [
      {
        key: 'version',
        label: 'Version',
        type: 'select',
        default: 'v4',
        choices: [
          { value: 'v4', label: 'v4 (random)' },
          { value: 'v7', label: 'v7 (time-ordered)' },
        ],
      },
      { key: 'count', label: 'How many', type: 'number', default: 1, min: 1, max: 1000 },
      { key: 'uppercase', label: 'Upper case', type: 'boolean', default: false },
    ],
    run: (_, { version, count, uppercase }) => {
      const ids = Array.from({ length: count }, () => (version === 'v7' ? uuidV7() : uuidV4()));
      return (uppercase ? ids.map((id) => id.toUpperCase()) : ids).join('\n');
    },
  }),
  generate({
    id: 'generate.random-string',
    name: 'Random String',
    description: 'Cryptographically random string from a character set.',
    aliases: ['token', 'nonce', 'random id', 'secret'],
    options: [
      { key: 'length', label: 'Length', type: 'number', default: 32, min: 1, max: 4096 },
      { key: 'charset', label: 'Characters', type: 'select', default: 'alphanumeric', choices: Object.keys(CHARSETS) },
      { key: 'custom', label: 'Custom characters (overrides)', type: 'text', default: '' },
    ],
    run: (_, { length, charset, custom }) => randomString(length, custom || CHARSETS[charset]),
  }),
  generate({
    id: 'generate.password',
    name: 'Password',
    description: 'Strong random password with Web Crypto randomness.',
    aliases: ['passphrase', 'secret'],
    options: [
      { key: 'length', label: 'Length', type: 'number', default: 20, min: 4, max: 256 },
      { key: 'upper', label: 'A–Z', type: 'boolean', default: true },
      { key: 'lower', label: 'a–z', type: 'boolean', default: true },
      { key: 'digits', label: '0–9', type: 'boolean', default: true },
      { key: 'symbols', label: 'Symbols', type: 'boolean', default: true },
    ],
    run: (_, options) => generatePassword(options),
  }),
  generate({
    id: 'generate.lorem',
    name: 'Lorem Ipsum',
    description: 'Placeholder text.',
    aliases: ['placeholder', 'dummy text', 'filler'],
    options: [
      {
        key: 'unit',
        label: 'Unit',
        type: 'select',
        default: 'paragraphs',
        choices: ['paragraphs', 'sentences', 'words'],
      },
      { key: 'count', label: 'Count', type: 'number', default: 3, min: 1, max: 200 },
    ],
    run: (_, options) => loremIpsum(options),
  }),
  generate({
    id: 'generate.timestamp',
    name: 'Current Timestamp',
    description: 'Insert the current date/time in a chosen format and zone.',
    aliases: ['now', 'date', 'time', 'today'],
    options: [
      {
        key: 'format',
        label: 'Format',
        type: 'select',
        default: 'iso',
        choices: [
          { value: 'iso', label: 'ISO-8601' },
          { value: 'date', label: 'Date (YYYY-MM-DD)' },
          { value: 'unix', label: 'Unix seconds' },
          { value: 'unix-ms', label: 'Unix ms' },
          { value: 'human', label: 'Human readable' },
          { value: 'custom', label: 'Custom pattern' },
        ],
      },
      { key: 'pattern', label: 'Custom pattern', type: 'text', default: 'YYYY-MM-DD HH:mm' },
      { key: 'zone', label: 'Time zone', type: 'text', default: 'local' },
    ],
    run: (_, { format, pattern, zone }) => {
      const now = new Date();
      if (format === 'unix') return String(Math.floor(now.getTime() / 1000));
      if (format === 'unix-ms') return String(now.getTime());
      if (format === 'date') return formatDate(now, 'YYYY-MM-DD', zone);
      if (format === 'human') return formatDate(now, 'dddd, MMMM D, YYYY h:mm A', zone);
      if (format === 'custom') return formatDate(now, pattern, zone);
      return formatIso(now, zone, { milliseconds: false });
    },
  }),
  generate({
    id: 'generate.qr-code',
    name: 'QR Code from Selection',
    description: 'Encode the selection as a QR code and insert it as an inline SVG image.',
    aliases: ['qr', 'barcode'],
    inputType: 'text',
    outputMode: 'insert',
    options: [
      {
        key: 'errorCorrection',
        label: 'Error correction',
        type: 'select',
        default: 'M',
        choices: ['L', 'M', 'Q', 'H'],
      },
      {
        key: 'format',
        label: 'Insert as',
        type: 'select',
        default: 'markdown',
        choices: [
          { value: 'markdown', label: 'Markdown image (data URI)' },
          { value: 'svg', label: 'Raw SVG' },
        ],
      },
    ],
    run: (input, { errorCorrection, format }) => {
      const svg = qrCodeSvg(input, { errorCorrection });
      if (format === 'svg') return svg;
      const alt = input.replace(/[[\]\n]/g, ' ').slice(0, 60);
      return `![QR code: ${alt}](data:image/svg+xml;base64,${base64Encode(svg)})`;
    },
  }),
];
