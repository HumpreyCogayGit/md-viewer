// Pure encoders/decoders. All functions work on Uint8Array or string and never touch the DOM.
import { bytesToHex, hexToBytes, toBytes, utf8Decode, utf8Encode } from '../bytes.js';

// ---------------------------------------------------------------- Base64 / Base64URL
export function base64Encode(input, { urlSafe = false, pad = true } = {}) {
  const bytes = toBytes(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let output = btoa(binary);
  if (urlSafe) output = output.replace(/\+/g, '-').replace(/\//g, '_');
  if (!pad) output = output.replace(/=+$/, '');
  return output;
}

export function base64Decode(input, { urlSafe = 'auto' } = {}) {
  let clean = String(input).replace(/\s+/g, '');
  if (urlSafe === true || (urlSafe === 'auto' && /[-_]/.test(clean)))
    clean = clean.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.replace(/=+$/, '').length % 4 === 1) {
    throw new Error('Invalid Base64: unexpected characters or length.');
  }
  clean = clean.replace(/=+$/, '');
  clean += '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export const isLikelyBase64 = (text) => {
  const clean = String(text).trim();
  return (
    clean.length >= 8 &&
    /^[A-Za-z0-9+/_-]+={0,2}$/.test(clean) &&
    clean.replace(/=+$/, '').length % 4 !== 1 &&
    /[A-Z]/.test(clean) &&
    /[a-z0-9]/.test(clean)
  );
};

// ---------------------------------------------------------------- Base32 (RFC 4648)
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(input, { pad = true } = {}) {
  const bytes = toBytes(input);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  if (pad) while (output.length % 8 !== 0) output += '=';
  return output;
}

export function base32Decode(input) {
  const clean = String(input).replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  if (/[^A-Z2-7]/.test(clean)) throw new Error('Invalid Base32: only A–Z and 2–7 are allowed.');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- Base58 (Bitcoin alphabet)
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(input) {
  const bytes = toBytes(input);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let output = '';
  while (number > 0n) {
    output = BASE58[Number(number % 58n)] + output;
    number /= 58n;
  }
  return '1'.repeat(zeros) + output;
}

export function base58Decode(input) {
  const clean = String(input).trim();
  let number = 0n;
  for (const char of clean) {
    const index = BASE58.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base58 character "${char}".`);
    number = number * 58n + BigInt(index);
  }
  const out = [];
  while (number > 0n) {
    out.unshift(Number(number % 256n));
    number /= 256n;
  }
  let zeros = 0;
  while (clean[zeros] === '1') zeros += 1;
  return new Uint8Array([...new Array(zeros).fill(0), ...out]);
}

// ---------------------------------------------------------------- Ascii85 / Base85
export function base85Encode(input, { delimiters = true } = {}) {
  const bytes = toBytes(input);
  let output = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [bytes[i], bytes[i + 1] ?? 0, bytes[i + 2] ?? 0, bytes[i + 3] ?? 0];
    const count = Math.min(4, bytes.length - i);
    let value = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    if (value === 0 && count === 4) {
      output += 'z';
      continue;
    }
    const encoded = [];
    for (let j = 0; j < 5; j += 1) {
      encoded.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    output += encoded.slice(0, count + 1).join('');
  }
  return delimiters ? `<~${output}~>` : output;
}

export function base85Decode(input) {
  let clean = String(input).replace(/\s+/g, '');
  if (clean.startsWith('<~')) clean = clean.slice(2);
  if (clean.endsWith('~>')) clean = clean.slice(0, -2);
  clean = clean.replace(/z/g, '!!!!!');
  if (/[^!-u]/.test(clean)) throw new Error('Invalid Ascii85: characters must be between ! and u.');
  const out = [];
  for (let i = 0; i < clean.length; i += 5) {
    const chunk = clean.slice(i, i + 5);
    const padded = chunk.padEnd(5, 'u');
    let value = 0;
    for (const char of padded) value = value * 85 + (char.charCodeAt(0) - 33);
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, chunk.length - 1));
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- URL encoding
export function urlEncode(text, { mode = 'component', plusForSpace = false } = {}) {
  const encoded = mode === 'uri' ? encodeURI(text) : encodeURIComponent(text);
  return plusForSpace ? encoded.replace(/%20/g, '+') : encoded;
}

export function urlDecode(text, { plusAsSpace = true } = {}) {
  const source = plusAsSpace ? String(text).replace(/\+/g, ' ') : String(text);
  try {
    return decodeURIComponent(source);
  } catch {
    throw new Error('Invalid percent-encoding (malformed % sequence or invalid UTF-8).');
  }
}

// ---------------------------------------------------------------- HTML entities
export const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  bull: '•',
  middot: '·',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  laquo: '«',
  raquo: '»',
  iexcl: '¡',
  iquest: '¿',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  rArr: '⇒',
  lArr: '⇐',
  hearts: '♥',
  spades: '♠',
  clubs: '♣',
  diams: '♦',
  ne: '≠',
  le: '≤',
  ge: '≥',
  infin: '∞',
  minus: '−',
  lowast: '∗',
  radic: '√',
  sum: '∑',
  prod: '∏',
  part: '∂',
  int: '∫',
  asymp: '≈',
  equiv: '≡',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  omega: 'ω',
  Omega: 'Ω',
  Delta: 'Δ',
  shy: '­',
  zwj: '‍',
  zwnj: '‌',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  check: '✓',
  cross: '✗',
  acute: '´',
  cedil: '¸',
  uml: '¨',
  macr: '¯',
  ordf: 'ª',
  ordm: 'º',
  not: '¬',
  curren: '¤',
  brvbar: '¦',
  Agrave: 'À',
  Aacute: 'Á',
  Acirc: 'Â',
  Atilde: 'Ã',
  Auml: 'Ä',
  Aring: 'Å',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Ecirc: 'Ê',
  Euml: 'Ë',
  Igrave: 'Ì',
  Iacute: 'Í',
  Icirc: 'Î',
  Iuml: 'Ï',
  Ntilde: 'Ñ',
  Ograve: 'Ò',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Otilde: 'Õ',
  Ouml: 'Ö',
  Oslash: 'Ø',
  Ugrave: 'Ù',
  Uacute: 'Ú',
  Ucirc: 'Û',
  Uuml: 'Ü',
  Yacute: 'Ý',
  szlig: 'ß',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
});

export function htmlEncode(text, { mode = 'minimal' } = {}) {
  let output = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  if (mode === 'all') {
    output = Array.from(output, (char) => {
      const code = char.codePointAt(0);
      return code > 126 || (code < 32 && !'\n\r\t'.includes(char)) ? `&#${code};` : char;
    }).join('');
  }
  return output;
}

export function htmlDecode(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity) ? NAMED_ENTITIES[entity] : match;
  });
}

// ---------------------------------------------------------------- Hex
export function hexEncode(input, { separator = '', uppercase = false } = {}) {
  const hex = bytesToHex(toBytes(input), separator);
  return uppercase ? hex.toUpperCase() : hex;
}
export const hexDecode = (text) => hexToBytes(text);

// ---------------------------------------------------------------- Unicode escapes
export function unicodeEscape(text, { style = 'js', all = false } = {}) {
  return Array.from(String(text), (char) => {
    const code = char.codePointAt(0);
    if (!all && code >= 32 && code < 127) return char;
    if (style === 'codepoint') return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    if (style === 'es6' || (style === 'python' && code > 0xffff)) {
      return style === 'python' ? `\\U${code.toString(16).padStart(8, '0')}` : `\\u{${code.toString(16)}}`;
    }
    if (code > 0xffff) {
      return Array.from({ length: 2 }, (_, i) => `\\u${char.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
    }
    return `\\u${code.toString(16).padStart(4, '0')}`;
  }).join('');
}

export function unicodeUnescape(text) {
  return String(text)
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\U([0-9a-f]{8})|U\+([0-9a-f]{4,6})/gi, (_, a, b, c) =>
      String.fromCodePoint(parseInt(a || b || c, 16)),
    )
    .replace(/(?:\\u[0-9a-f]{4})+/gi, (sequence) =>
      String.fromCharCode(...sequence.match(/[0-9a-f]{4}/gi).map((hex) => parseInt(hex, 16))),
    )
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ---------------------------------------------------------------- Generic string escapes
const SIMPLE_ESCAPES = { '\n': 'n', '\r': 'r', '\t': 't', '\b': 'b', '\f': 'f', '\v': 'v', '\0': '0', '\\': '\\' };

export function escapeString(text, { style = 'js', quote = '"' } = {}) {
  const source = String(text);
  if (style === 'json') return JSON.stringify(source).slice(1, -1);
  if (style === 'c') {
    return Array.from(utf8Encode(source), (byte) => {
      const char = String.fromCharCode(byte);
      if (char === '\x07') return '\\a';
      if (char === '\0') return '\\0';
      if (SIMPLE_ESCAPES[char] && char !== '\0') return `\\${SIMPLE_ESCAPES[char]}`;
      if (char === '"' || char === "'" || char === '?') return char === quote || char === '?' ? `\\${char}` : char;
      if (byte < 32 || byte > 126) return `\\x${byte.toString(16).padStart(2, '0')}`;
      return char;
    }).join('');
  }
  return Array.from(source, (char) => {
    if (style === 'python' && char === '\v') return '\\x0b';
    if (style === 'python' && char === '\0') return '\\x00';
    if (SIMPLE_ESCAPES[char]) return `\\${SIMPLE_ESCAPES[char]}`;
    if (char === quote) return `\\${char}`;
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return `\\x${code.toString(16).padStart(2, '0')}`;
    return char;
  }).join('');
}

const UNESCAPE_MAP = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  a: '\x07',
  0: '\0',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '/': '/',
  '?': '?',
  '`': '`',
  $: '$',
};

/** Unescape JS/JSON/Python/C style sequences. \xNN bytes are combined and decoded as UTF-8 when valid. */
export function unescapeString(text) {
  const bytes = [];
  let output = '';
  const flushBytes = () => {
    if (bytes.length === 0) return;
    const chunk = new Uint8Array(bytes.splice(0));
    try {
      output += utf8Decode(chunk, { fatal: true });
    } catch {
      output += String.fromCharCode(...chunk);
    }
  };
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char !== '\\' || i === source.length - 1) {
      flushBytes();
      output += char;
      continue;
    }
    const next = source[i + 1];
    let match;
    if ((match = /^x([0-9a-fA-F]{2})/.exec(source.slice(i + 1)))) {
      bytes.push(parseInt(match[1], 16));
      i += 3;
      continue;
    }
    flushBytes();
    if ((match = /^u\{([0-9a-fA-F]{1,6})\}/.exec(source.slice(i + 1)))) {
      output += String.fromCodePoint(parseInt(match[1], 16));
      i += match[0].length;
    } else if ((match = /^u([0-9a-fA-F]{4})/.exec(source.slice(i + 1)))) {
      output += String.fromCharCode(parseInt(match[1], 16));
      i += 5;
    } else if ((match = /^U([0-9a-fA-F]{8})/.exec(source.slice(i + 1)))) {
      output += String.fromCodePoint(parseInt(match[1], 16));
      i += 9;
    } else if ((match = /^([0-7]{1,3})/.exec(source.slice(i + 1))) && match[1] !== '0') {
      output += String.fromCharCode(parseInt(match[1], 8));
      i += match[1].length;
    } else if (UNESCAPE_MAP[next] !== undefined) {
      output += UNESCAPE_MAP[next];
      i += 1;
    } else {
      output += next;
      i += 1;
    }
  }
  flushBytes();
  return output;
}

// ---------------------------------------------------------------- Numeric byte / code point representations
const RADIX = { binary: 2, octal: 8, decimal: 10, hex: 16 };
const WIDTH = { binary: 8, octal: 3, decimal: 0, hex: 2 };

export function bytesToBase(input, base = 'binary', separator = ' ') {
  return Array.from(toBytes(input), (byte) => byte.toString(RADIX[base]).padStart(WIDTH[base], '0')).join(separator);
}

export function baseToBytes(text, base = 'binary') {
  const parts = String(text)
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  return new Uint8Array(
    parts.map((part) => {
      const clean = part.replace(/^0[bxo]/i, '');
      const value = parseInt(clean, RADIX[base]);
      if (
        Number.isNaN(value) ||
        value < 0 ||
        value > 255 ||
        !new RegExp(`^[${'0123456789abcdef'.slice(0, RADIX[base])}]+$`, 'i').test(clean)
      ) {
        throw new Error(`"${part}" is not a valid ${base} byte (0–255).`);
      }
      return value;
    }),
  );
}

export function textToCharCodes(text, { base = 'decimal', separator = ' ' } = {}) {
  return Array.from(String(text), (char) => {
    const code = char.codePointAt(0);
    return base === 'hex' ? `0x${code.toString(16)}` : String(code);
  }).join(separator);
}

export function charCodesToText(text) {
  const parts = String(text)
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  return parts
    .map((part) => {
      const value = /^0x/i.test(part)
        ? parseInt(part, 16)
        : /^u\+/i.test(part)
          ? parseInt(part.slice(2), 16)
          : Number(part);
      if (!Number.isInteger(value) || value < 0 || value > 0x10ffff)
        throw new Error(`"${part}" is not a valid code point.`);
      return String.fromCodePoint(value);
    })
    .join('');
}

// ---------------------------------------------------------------- Hexdump
export function toHexdump(input, { width = 16 } = {}) {
  const bytes = toBytes(input);
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += width) {
    const chunk = bytes.subarray(offset, offset + width);
    const hexParts = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0'));
    const half = Math.ceil(width / 2);
    const hex = `${hexParts.slice(0, half).join(' ')}${hexParts.length > half ? `  ${hexParts.slice(half).join(' ')}` : ''}`;
    const fullWidth = width * 3 + (width > half ? 1 : 0) - 1;
    const ascii = Array.from(chunk, (byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(fullWidth)}  |${ascii}|`);
  }
  lines.push(bytes.length.toString(16).padStart(8, '0'));
  return lines.join('\n');
}

export function fromHexdump(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s*\|.*\|\s*$/, '').trim();
    if (!line) continue;
    const match = /^([0-9a-f]+)[:\s]\s*(.*)$/i.exec(line);
    if (!match) continue;
    const hexBytes = match[2].match(/\b[0-9a-f]{2}\b/gi) || [];
    out.push(...hexBytes.map((hex) => parseInt(hex, 16)));
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- ROT13 / ROT47
export const rot13 = (text) =>
  String(text).replace(/[a-z]/gi, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });

export const rot47 = (text) =>
  String(text).replace(/[!-~]/g, (char) => String.fromCharCode(33 + ((char.charCodeAt(0) - 33 + 47) % 94)));

// ---------------------------------------------------------------- Quoted-printable (RFC 2045)
export function quotedPrintableEncode(input) {
  const bytes = toBytes(input);
  const lines = [];
  let line = '';
  const push = (token) => {
    if (line.length + token.length > 75) {
      lines.push(`${line}=`);
      line = '';
    }
    line += token;
  };
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 0x0a) {
      lines.push(line.replace(/[ \t]$/, (ws) => `=${ws.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`));
      line = '';
      continue;
    }
    if (byte === 0x0d && bytes[i + 1] === 0x0a) continue;
    const printable = (byte >= 33 && byte <= 126 && byte !== 61) || byte === 32 || byte === 9;
    push(printable ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  lines.push(line.replace(/[ \t]$/, (ws) => `=${ws.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`));
  return lines.join('\n');
}

export function quotedPrintableDecode(text) {
  const source = String(text).replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
      out.push(parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(...utf8Encode(source[i]));
    }
  }
  return new Uint8Array(out);
}

/** Decode RFC 2047 MIME encoded-words (=?charset?B|Q?text?=) found in a header line. */
export function decodeMimeEncodedWords(text) {
  return String(text)
    .replace(/(=\?[^?]+\?[BQbq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, payload) => {
      const bytes =
        encoding.toUpperCase() === 'B' ? base64Decode(payload) : quotedPrintableDecode(payload.replace(/_/g, ' '));
      try {
        return new TextDecoder(charset.toLowerCase().replace(/\*.*$/, '')).decode(bytes);
      } catch {
        return utf8Decode(bytes);
      }
    });
}

// ---------------------------------------------------------------- Morse
const MORSE = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([key, value]) => [value, key]));

export function morseEncode(text) {
  return String(text)
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      Array.from(word, (char) => MORSE[char] ?? '')
        .filter(Boolean)
        .join(' '),
    )
    .join(' / ');
}

export function morseDecode(text) {
  return String(text)
    .trim()
    .split(/\s*\/\s*|\s{3,}/)
    .map((word) =>
      word
        .split(/\s+/)
        .map((code) => MORSE_REVERSE[code] ?? (code ? '?' : ''))
        .join(''),
    )
    .join(' ');
}

// ---------------------------------------------------------------- Braille (Grade 1, letters/digits)
const BRAILLE_LETTERS = '⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵';
export function brailleEncode(text) {
  return Array.from(String(text).toLowerCase(), (char) => {
    const index = char.charCodeAt(0) - 97;
    if (index >= 0 && index < 26) return BRAILLE_LETTERS[index];
    if (/[0-9]/.test(char)) return `⠼${BRAILLE_LETTERS[(Number(char) + 9) % 10]}`;
    return char === ' ' ? '⠀' : char;
  }).join('');
}

export function brailleDecode(text) {
  let output = '';
  const chars = Array.from(String(text));
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === '⠼' && chars[i + 1]) {
      const index = BRAILLE_LETTERS.indexOf(chars[i + 1]);
      output += index >= 0 && index < 10 ? String((index + 1) % 10) : '?';
      i += 1;
    } else if (chars[i] === '⠀') output += ' ';
    else {
      const index = BRAILLE_LETTERS.indexOf(chars[i]);
      output += index >= 0 ? String.fromCharCode(97 + index) : chars[i];
    }
  }
  return output;
}
