import cronstrue from 'cronstrue';
import { diffLines, createTwoFilesPatch } from 'diff';
import { markdownTable, operationFactory, splitTwoInputs } from '../define.js';

// ---------------------------------------------------------------- Number bases
const PREFIX_BASES = { '0x': 16, '0b': 2, '0o': 8 };

export function parseInteger(text, base = 'auto') {
  let value = String(text).trim().replace(/_/g, '');
  const negative = value.startsWith('-');
  if (negative) value = value.slice(1);
  let radix = base === 'auto' ? 10 : Number(base);
  const prefix = value.slice(0, 2).toLowerCase();
  if (PREFIX_BASES[prefix] && (base === 'auto' || PREFIX_BASES[prefix] === radix)) {
    radix = PREFIX_BASES[prefix];
    value = value.slice(2);
  } else if (base === 'auto' && /^0[0-7]+$/.test(value)) {
    radix = 8;
  }
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, radix);
  if (!value || !new RegExp(`^[${digits}]+$`, 'i').test(value))
    throw new Error(`"${text}" is not a valid base-${radix} integer.`);
  const result = Array.from(value.toLowerCase()).reduce(
    (total, char) => total * BigInt(radix) + BigInt(digits.indexOf(char)),
    0n,
  );
  return negative ? -result : result;
}

export function convertBases(text, { from = 'auto' } = {}) {
  const rows = String(text)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      const value = parseInteger(token, from);
      const abs = value < 0n ? -value : value;
      const sign = value < 0n ? '-' : '';
      return [
        token,
        `${sign}${abs.toString(10)}`,
        `${sign}0x${abs.toString(16)}`,
        `${sign}0o${abs.toString(8)}`,
        `${sign}0b${abs.toString(2)}`,
      ];
    });
  return markdownTable(['Input', 'Decimal', 'Hex', 'Octal', 'Binary'], rows);
}

export function convertBaseTo(text, { from = 'auto', to = 16, prefix = true } = {}) {
  const names = { 2: '0b', 8: '0o', 16: '0x' };
  const tokenPattern =
    {
      auto: /(?<![\w.])-?(?:0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*)(?![\w.])/gi,
      2: /(?<![\w.])-?(?:0b)?[01_]+(?![\w.])/gi,
      8: /(?<![\w.])-?(?:0o)?[0-7_]+(?![\w.])/gi,
      10: /(?<![\w.])-?\d[\d_]*(?![\w.])/g,
      16: /(?<![\w.])-?(?:0x)?[0-9a-f_]+(?![\w.])/gi,
    }[from] ?? /(?<![\w.])-?[0-9a-z_]+(?![\w.])/gi;
  return String(text).replace(tokenPattern, (token) => {
    const value = parseInteger(token, from);
    const abs = value < 0n ? -value : value;
    return `${value < 0n ? '-' : ''}${prefix && names[to] ? names[to] : ''}${abs.toString(Number(to))}`;
  });
}

// ---------------------------------------------------------------- Colors
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function parseColor(text) {
  const value = String(text).trim().toLowerCase();
  let match;
  if ((match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value))) {
    let hex = match[1];
    if (hex.length <= 4) hex = Array.from(hex, (char) => char + char).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  if ((match = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value))) {
    const channel = (part) => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part));
    const alpha =
      match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return {
      r: clamp(Math.round(channel(match[1])), 0, 255),
      g: clamp(Math.round(channel(match[2])), 0, 255),
      b: clamp(Math.round(channel(match[3])), 0, 255),
      a: clamp(alpha, 0, 1),
    };
  }
  if ((match = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value))) {
    const alpha =
      match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return { ...hslToRgb(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])), a: alpha };
  }
  throw new Error(`Unrecognized color: ${text}. Use #hex, rgb() or hsl().`);
}

export function hslToRgb(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function rgbToHsl({ r, g, b }) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function colorFormats(text) {
  const color = parseColor(text);
  const hex = `#${[color.r, color.g, color.b].map((c) => c.toString(16).padStart(2, '0')).join('')}${
    color.a < 1
      ? Math.round(color.a * 255)
          .toString(16)
          .padStart(2, '0')
      : ''
  }`;
  const { h, s, l } = rgbToHsl(color);
  const alpha = color.a < 1 ? ` / ${+color.a.toFixed(3)}` : '';
  const luminance = [color.r, color.g, color.b]
    .map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((total, v, i) => total + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrastWhite = (1.05 / (luminance + 0.05)).toFixed(2);
  const contrastBlack = ((luminance + 0.05) / 0.05).toFixed(2);
  return markdownTable(
    ['Format', 'Value'],
    [
      ['HEX', hex],
      ['RGB', `rgb(${color.r} ${color.g} ${color.b}${alpha})`],
      ['HSL', `hsl(${h} ${s}% ${l}%${alpha})`],
      ['Contrast vs white', `${contrastWhite}:1`],
      ['Contrast vs black', `${contrastBlack}:1`],
    ],
  );
}

// ---------------------------------------------------------------- Units
const UNIT_TABLES = {
  data: {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    PB: 1e15,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
    PiB: 1024 ** 5,
    bit: 1 / 8,
    Kbit: 125,
    Mbit: 125e3,
    Gbit: 125e6,
  },
  length: { mm: 1e-3, cm: 1e-2, m: 1, km: 1e3, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
  mass: { mg: 1e-6, g: 1e-3, kg: 1, t: 1e3, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 },
  time: { ms: 1e-3, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31557600 },
};
const TEMPERATURE = ['C', 'F', 'K'];

export function convertUnits(text, { to = '' } = {}) {
  const match = /^\s*(-?[\d.,]+(?:e[-+]?\d+)?)\s*([A-Za-z°]+)\s*$/i.exec(String(text));
  if (!match) throw new Error('Enter a value with a unit, e.g. "1.5 GiB", "10 km", "72 F".');
  const value = Number(match[1].replace(/,/g, ''));
  const unit = match[2].replace('°', '');
  if (TEMPERATURE.includes(unit.toUpperCase()) && unit.length === 1) {
    const u = unit.toUpperCase();
    const c = u === 'C' ? value : u === 'F' ? ((value - 32) * 5) / 9 : value - 273.15;
    const rows = [
      ['°C', c],
      ['°F', (c * 9) / 5 + 32],
      ['K', c + 273.15],
    ].map(([name, v]) => [name, +v.toFixed(4)]);
    return markdownTable(
      ['Unit', 'Value'],
      to ? rows.filter(([name]) => name.replace('°', '').toUpperCase() === to.toUpperCase()) : rows,
    );
  }
  const entry = Object.entries(UNIT_TABLES).find(
    ([, table]) =>
      Object.keys(table).some((key) => key === unit) ||
      Object.keys(table).some((key) => key.toLowerCase() === unit.toLowerCase()),
  );
  if (!entry) throw new Error(`Unknown unit "${unit}".`);
  const [, table] = entry;
  const key =
    Object.keys(table).find((k) => k === unit) ||
    Object.keys(table).find((k) => k.toLowerCase() === unit.toLowerCase());
  const base = value * table[key];
  const format = (v) => (Math.abs(v) >= 1e-4 && Math.abs(v) < 1e15 ? String(+v.toPrecision(10)) : v.toExponential(6));
  const rows = Object.entries(table)
    .filter(([name]) => !to || name.toLowerCase() === to.toLowerCase())
    .map(([name, factor]) => [name, format(base / factor)]);
  if (rows.length === 0) throw new Error(`Cannot convert ${key} to ${to}.`);
  return markdownTable(['Unit', 'Value'], rows);
}

// ---------------------------------------------------------------- File permissions
const PERMISSION_BITS = ['r', 'w', 'x'];

export function permissions(text) {
  const value = String(text).trim();
  let octal;
  if (/^[0-7]{3,4}$/.test(value)) octal = value.padStart(4, '0');
  else if (/^[-dlcbps]?[rwxsStT-]{9}$/.test(value)) {
    const symbols = value.length === 10 ? value.slice(1) : value;
    let special = 0;
    const digits = [0, 1, 2].map((group) => {
      const triplet = symbols.slice(group * 3, group * 3 + 3);
      let digit = 0;
      if (triplet[0] === 'r') digit += 4;
      if (triplet[1] === 'w') digit += 2;
      if (/[xst]/.test(triplet[2])) digit += 1;
      if (/[sStT]/.test(triplet[2])) special += [4, 2, 1][group];
      return digit;
    });
    octal = `${special}${digits.join('')}`;
  } else throw new Error('Enter octal (755, 0644) or symbolic (rwxr-xr-x) permissions.');
  const [special, ...groups] = Array.from(octal, Number);
  const symbolic = groups
    .map((digit, group) => {
      const chars = PERMISSION_BITS.map((bit, i) => (digit & (4 >> i) ? bit : '-'));
      const specialBit = [4, 2, 1][group];
      if (special & specialBit) chars[2] = group === 2 ? (chars[2] === 'x' ? 't' : 'T') : chars[2] === 'x' ? 's' : 'S';
      return chars.join('');
    })
    .join('');
  const describe = (digit) =>
    [digit & 4 && 'read', digit & 2 && 'write', digit & 1 && 'execute'].filter(Boolean).join(', ') || 'no access';
  const specials = [special & 4 && 'setuid', special & 2 && 'setgid', special & 1 && 'sticky'].filter(Boolean);
  return markdownTable(
    ['Form', 'Value'],
    [
      ['Octal', octal.startsWith('0') ? octal.slice(1) : octal],
      ['Symbolic', symbolic],
      ['Owner', describe(groups[0])],
      ['Group', describe(groups[1])],
      ['Others', describe(groups[2])],
      ...(specials.length ? [['Special', specials.join(', ')]] : []),
      ['chmod', `chmod ${octal.startsWith('0') ? octal.slice(1) : octal} file`],
    ],
  );
}

// ---------------------------------------------------------------- Cron
export function explainCron(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      const expression = fields[0].startsWith('@')
        ? fields[0]
        : fields.slice(0, fields.length >= 6 && /^[\d*/,?-]+$/.test(fields[5]) ? 6 : 5).join(' ');
      const macros = {
        '@yearly': '0 0 1 1 *',
        '@annually': '0 0 1 1 *',
        '@monthly': '0 0 1 * *',
        '@weekly': '0 0 * * 0',
        '@daily': '0 0 * * *',
        '@midnight': '0 0 * * *',
        '@hourly': '0 * * * *',
      };
      if (expression === '@reboot') return `\`${expression}\` — At system startup`;
      try {
        return `\`${expression}\` — ${cronstrue.toString(macros[expression] || expression, { use24HourTimeFormat: true, verbose: true })}`;
      } catch (error) {
        throw new Error(`Invalid cron expression "${expression}": ${String(error).replace(/^Error: /, '')}`, {
          cause: error,
        });
      }
    })
    .join('\n');
}

// ---------------------------------------------------------------- User agent
export function parseUserAgent(text) {
  const ua = String(text).trim();
  const find = (patterns) => {
    for (const [name, pattern] of patterns) {
      const match = pattern.exec(ua);
      if (match) return `${name}${match[1] ? ` ${match[1].replace(/_/g, '.')}` : ''}`;
    }
    return 'Unknown';
  };
  const browser = find([
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
    ['Internet Explorer', /(?:MSIE |Trident\/.*rv:)([\d.]+)/],
    ['curl', /curl\/([\d.]+)/],
    ['Python requests', /python-requests\/([\d.]+)/],
  ]);
  const os = find([
    ['iOS', /(?:iPhone|iPad|iPod).*OS ([\d_]+)/],
    ['Android', /Android ([\d.]+)/],
    ['Windows', /Windows NT ([\d.]+)/],
    ['macOS', /Mac OS X ([\d_.]+)/],
    ['Chrome OS', /CrOS \S+ ([\d.]+)/],
    ['Linux', /(Linux)/],
  ])
    .replace(/^Windows 10\.0$/, 'Windows 10/11')
    .replace('Linux Linux', 'Linux');
  const engine = find([
    ['Blink', /Chrome\/([\d.]+)/],
    ['Gecko', /Gecko\/(\d+)/],
    ['WebKit', /AppleWebKit\/([\d.]+)/],
    ['Trident', /Trident\/([\d.]+)/],
  ]);
  const device = /bot|crawler|spider|crawling/i.test(ua)
    ? 'Bot'
    : /iPad|Tablet/i.test(ua)
      ? 'Tablet'
      : /Mobi|iPhone|Android/i.test(ua)
        ? 'Mobile'
        : 'Desktop';
  return markdownTable(
    ['Field', 'Value'],
    [
      ['Browser', browser],
      ['Engine', engine],
      ['OS', os],
      ['Device', device],
    ],
  );
}

// ---------------------------------------------------------------- Diff
export function diffTexts(input, { format = 'unified', context = 3 } = {}) {
  const [a, b] = splitTwoInputs(input);
  const left = a.endsWith('\n') ? a : `${a}\n`;
  const right = b.endsWith('\n') ? b : `${b}\n`;
  if (left === right) return 'No differences.';
  if (format === 'summary') {
    const parts = diffLines(left, right);
    const added = parts.filter((p) => p.added).reduce((n, p) => n + p.count, 0);
    const removed = parts.filter((p) => p.removed).reduce((n, p) => n + p.count, 0);
    return `${added} line(s) added, ${removed} line(s) removed.`;
  }
  const patch = createTwoFilesPatch('a', 'b', left, right, '', '', { context })
    .split('\n')
    .slice(2)
    .join('\n')
    .trimEnd();
  return `\`\`\`diff\n${patch.replace(/^Index:.*\n=+\n/, '')}\n\`\`\``;
}

// ---------------------------------------------------------------- Operations
const convert = operationFactory('Developer', { outputMode: 'report' });

export const inspectOperations = [
  convert({
    id: 'number.base-table',
    name: 'Number Base Conversion',
    description: 'Show integers in decimal, hex, octal and binary (BigInt, any size).',
    aliases: ['hex to decimal', 'binary', 'radix'],
    options: [
      {
        key: 'from',
        label: 'Input base',
        type: 'select',
        default: 'auto',
        choices: [
          { value: 'auto', label: 'Auto (0x/0b/0o prefixes)' },
          { value: '2', label: '2' },
          { value: '8', label: '8' },
          { value: '10', label: '10' },
          { value: '16', label: '16' },
          { value: '36', label: '36' },
        ],
      },
    ],
    run: convertBases,
  }),
  convert({
    id: 'number.convert-base',
    name: 'Convert Numbers to Base',
    description: 'Rewrite every integer in the selection in another base.',
    aliases: ['to hex', 'to binary', 'radix'],
    outputMode: 'replace',
    options: [
      {
        key: 'from',
        label: 'Input base',
        type: 'select',
        default: 'auto',
        choices: [
          { value: 'auto', label: 'Auto' },
          { value: '2', label: '2' },
          { value: '8', label: '8' },
          { value: '10', label: '10' },
          { value: '16', label: '16' },
        ],
      },
      { key: 'to', label: 'Output base', type: 'select', default: '16', choices: ['2', '8', '10', '16', '36'] },
      { key: 'prefix', label: 'Add 0x/0b/0o prefix', type: 'boolean', default: true },
    ],
    run: (input, options) => convertBaseTo(input, { ...options, to: Number(options.to) }),
  }),
  convert({
    id: 'color.convert',
    name: 'Color Converter',
    description: 'Convert between HEX, RGB and HSL and show WCAG contrast.',
    aliases: ['hex', 'rgb', 'hsl', 'colour'],
    run: colorFormats,
  }),
  convert({
    id: 'units.convert',
    name: 'Unit Conversion',
    description: 'Data size (KB/KiB), length, mass, time and temperature.',
    aliases: ['bytes', 'kib', 'mib', 'celsius', 'fahrenheit', 'miles', 'km'],
    options: [{ key: 'to', label: 'Target unit (blank = all)', type: 'text', default: '' }],
    run: convertUnits,
  }),
  convert({
    id: 'unix.permissions',
    name: 'File Permissions',
    description: 'Translate chmod octal ↔ symbolic and describe access.',
    aliases: ['chmod', 'rwx', '755', 'umask'],
    run: permissions,
  }),
  convert({
    id: 'cron.explain',
    name: 'Explain Cron Expression',
    description: 'Describe cron schedules in plain English.',
    aliases: ['crontab', 'schedule'],
    run: explainCron,
  }),
  convert({
    id: 'useragent.parse',
    name: 'Parse User-Agent',
    description: 'Identify browser, engine, OS and device type.',
    aliases: ['ua', 'browser'],
    run: parseUserAgent,
  }),
  convert({
    id: 'diff.texts',
    name: 'Diff Two Texts',
    description: 'Unified diff of two texts separated by a --- line.',
    aliases: ['compare', 'difference', 'patch'],
    options: [
      {
        key: 'format',
        label: 'Output',
        type: 'select',
        default: 'unified',
        choices: [
          { value: 'unified', label: 'Unified diff' },
          { value: 'summary', label: 'Summary' },
        ],
      },
      { key: 'context', label: 'Context lines', type: 'number', default: 3, min: 0, max: 50 },
    ],
    run: diffTexts,
  }),
];
