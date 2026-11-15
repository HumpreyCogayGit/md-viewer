import { markdownTable, operationFactory, splitLines, splitTwoInputs } from '../define.js';

const op = operationFactory('Date & Time');

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error(`Unknown time zone "${timeZone}". Use UTC, local, or an IANA name such as Europe/Paris.`);
  }
}

const resolveZone = (zone) => (!zone || zone === 'local' ? localTimeZone() : zone);

/** Offset in minutes of a time zone at an instant (east of UTC positive). */
export function zoneOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60000);
}

const pad = (value, width = 2) => String(value).padStart(width, '0');

/** ISO-8601 string in a time zone: `Z` for UTC, otherwise a ±hh:mm offset. */
export function formatIso(date, zone = 'UTC', { milliseconds = 'auto' } = {}) {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
  const timeZone = resolveZone(zone);
  assertTimeZone(timeZone);
  const offset = timeZone === 'UTC' ? 0 : zoneOffsetMinutes(date, timeZone);
  const shifted = new Date(date.getTime() + offset * 60000);
  const ms = shifted.getUTCMilliseconds();
  const showMs = milliseconds === true || (milliseconds === 'auto' && ms !== 0);
  const base = `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${showMs ? `.${pad(ms, 3)}` : ''}`;
  if (timeZone === 'UTC') return `${base}Z`;
  const sign = offset >= 0 ? '+' : '-';
  return `${base}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/** Interpret wall-clock components in a time zone, resolving DST gaps forward. */
export function fromZonedParts({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }, zone) {
  const timeZone = resolveZone(zone);
  assertTimeZone(timeZone);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstOffset = zoneOffsetMinutes(new Date(guess), timeZone);
  const first = guess - firstOffset * 60000;
  const secondOffset = zoneOffsetMinutes(new Date(first), timeZone);
  if (secondOffset === firstOffset) return new Date(first);
  const second2 = guess - secondOffset * 60000;
  if (zoneOffsetMinutes(new Date(second2), timeZone) === secondOffset) return new Date(second2);
  // The wall time does not exist (spring-forward gap): move forward past the gap.
  return new Date(Math.max(first, second2));
}

/**
 * Parse a date string or Unix timestamp. Strings without a zone are interpreted in `assume`.
 * Numeric slash dates (01/02/2024) are rejected as ambiguous unless `order` is MDY or DMY.
 */
export function parseDate(input, { assume = 'UTC', unit = 'auto', order = 'reject' } = {}) {
  const text = String(input).trim();
  if (!text) throw new Error('Empty date.');

  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const value = Number(text);
    const resolvedUnit = unit === 'auto' ? (Math.abs(value) >= 1e11 ? 'ms' : 's') : unit;
    const date = new Date(resolvedUnit === 'ms' ? value : value * 1000);
    if (Number.isNaN(date.getTime())) throw new Error(`Timestamp out of range: ${text}`);
    return date;
  }

  const iso = ISO_PATTERN.exec(text);
  if (iso) {
    const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0', zone] = iso;
    const parts = {
      year: +year,
      month: +month,
      day: +day,
      hour: +hour,
      minute: +minute,
      second: +second,
      millisecond: Math.round(Number(`0.${fraction}`) * 1000),
    };
    if (
      parts.month < 1 ||
      parts.month > 12 ||
      parts.day < 1 ||
      parts.day > 31 ||
      parts.hour > 23 ||
      parts.minute > 59 ||
      parts.second > 60
    ) {
      throw new Error(`Invalid date: ${text}`);
    }
    let date;
    if (zone) {
      const offset =
        zone.toUpperCase() === 'Z'
          ? 0
          : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
      date = new Date(
        Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond) -
          offset * 60000,
      );
    } else {
      date =
        assume === 'UTC'
          ? new Date(
              Date.UTC(
                parts.year,
                parts.month - 1,
                parts.day,
                parts.hour,
                parts.minute,
                parts.second,
                parts.millisecond,
              ),
            )
          : fromZonedParts(parts, assume);
    }
    const check = assume === 'UTC' || zone ? date : null;
    if (check && !zone && check.getUTCDate() !== parts.day) throw new Error(`Invalid date: ${text}`);
    return date;
  }

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (slash) {
    const [, a, b, y, hour = '0', minute = '0', second = '0'] = slash;
    let effectiveOrder = order;
    if (effectiveOrder === 'reject') {
      if (+a > 12 && +b <= 12) effectiveOrder = 'DMY';
      else if (+b > 12 && +a <= 12) effectiveOrder = 'MDY';
      else throw new Error(`Ambiguous date "${text}": use ISO-8601 (YYYY-MM-DD) or choose day/month order.`);
    }
    const [month, day] = effectiveOrder === 'MDY' ? [+a, +b] : [+b, +a];
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return fromZonedParts({ year, month, day, hour: +hour, minute: +minute, second: +second }, assume);
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new Error(`Unrecognized date: ${text}`);
  return new Date(parsed);
}

// ---------------------------------------------------------------- Durations
const UNITS = [
  ['y', 365 * 24 * 3600 * 1000],
  ['w', 7 * 24 * 3600 * 1000],
  ['d', 24 * 3600 * 1000],
  ['h', 3600 * 1000],
  ['m', 60 * 1000],
  ['s', 1000],
  ['ms', 1],
];

export function formatDuration(ms, { style = 'short', largest = 'd' } = {}) {
  const negative = ms < 0;
  let remaining = Math.abs(Math.round(ms));
  const startIndex = UNITS.findIndex(([unit]) => unit === largest);
  const parts = [];
  for (const [unit, size] of UNITS.slice(Math.max(startIndex, 0))) {
    const count = Math.floor(remaining / size);
    remaining -= count * size;
    if (count) parts.push([unit, count]);
  }
  if (style === 'iso') {
    const get = (unit) => parts.find(([u]) => u === unit)?.[1] || 0;
    const days = get('d') + get('w') * 7 + get('y') * 365;
    const seconds = get('s') + get('ms') / 1000;
    const time = `${get('h') ? `${get('h')}H` : ''}${get('m') ? `${get('m')}M` : ''}${seconds ? `${seconds}S` : ''}`;
    const result = `P${days ? `${days}D` : ''}${time ? `T${time}` : ''}`;
    return (negative ? '-' : '') + (result === 'P' ? 'PT0S' : result);
  }
  if (parts.length === 0) return '0s';
  const names = { y: 'year', w: 'week', d: 'day', h: 'hour', m: 'minute', s: 'second', ms: 'millisecond' };
  const text =
    style === 'long'
      ? parts.map(([unit, count]) => `${count} ${names[unit]}${count === 1 ? '' : 's'}`).join(', ')
      : parts.map(([unit, count]) => `${count}${unit}`).join(' ');
  return (negative ? '-' : '') + text;
}

/** Parse "1h 30m", "90s", "2d4h", "1.5h", or ISO-8601 durations (P1DT2H) into milliseconds. */
export function parseDuration(text) {
  const value = String(text).trim();
  const iso =
    /^(-)?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      value,
    );
  if (iso && value.length > 1 && !/^-?PT?$/i.test(value)) {
    const [, sign, y, w, d, h, m, s] = iso;
    const total =
      (+y || 0) * 365 * 864e5 +
      (+w || 0) * 7 * 864e5 +
      (+d || 0) * 864e5 +
      (+h || 0) * 36e5 +
      (+m || 0) * 6e4 +
      (+s || 0) * 1e3;
    return sign ? -total : total;
  }
  const negative = value.startsWith('-');
  const body = value.replace(/^[-+]/, '');
  const pattern =
    /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|y|years?)\b/gi;
  let total = 0;
  let matched = '';
  for (const match of body.matchAll(pattern)) {
    const unit = match[2].toLowerCase();
    const size =
      unit === 'ms' || unit.startsWith('milli')
        ? 1
        : unit.startsWith('s')
          ? 1e3
          : unit.startsWith('m')
            ? 6e4
            : unit.startsWith('h')
              ? 36e5
              : unit.startsWith('d')
                ? 864e5
                : unit.startsWith('w')
                  ? 6048e5
                  : 31536e6;
    total += Number(match[1]) * size;
    matched += match[0];
  }
  if (!matched || body.replace(/[\s,]|and/g, '').length !== matched.replace(/\s/g, '').length) {
    if (/^\d+(\.\d+)?$/.test(body)) return (negative ? -1 : 1) * Number(body) * 1000;
    throw new Error(`Unrecognized duration: ${text}`);
  }
  return negative ? -total : total;
}

// ---------------------------------------------------------------- Custom formats
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Format with tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss SSS A Z ZZ X x. Text in [brackets] is literal. */
export function formatDate(date, pattern, zone = 'UTC') {
  const timeZone = resolveZone(zone);
  assertTimeZone(timeZone);
  const offset = timeZone === 'UTC' ? 0 : zoneOffsetMinutes(date, timeZone);
  const d = new Date(date.getTime() + offset * 60000);
  const sign = offset >= 0 ? '+' : '-';
  const offsetText = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const tokens = {
    YYYY: () => pad(d.getUTCFullYear(), 4),
    YY: () => pad(d.getUTCFullYear() % 100),
    MMMM: () => MONTHS[d.getUTCMonth()],
    MMM: () => MONTHS[d.getUTCMonth()].slice(0, 3),
    MM: () => pad(d.getUTCMonth() + 1),
    M: () => String(d.getUTCMonth() + 1),
    DD: () => pad(d.getUTCDate()),
    D: () => String(d.getUTCDate()),
    dddd: () => DAYS[d.getUTCDay()],
    ddd: () => DAYS[d.getUTCDay()].slice(0, 3),
    HH: () => pad(d.getUTCHours()),
    H: () => String(d.getUTCHours()),
    hh: () => pad(d.getUTCHours() % 12 || 12),
    h: () => String(d.getUTCHours() % 12 || 12),
    mm: () => pad(d.getUTCMinutes()),
    ss: () => pad(d.getUTCSeconds()),
    SSS: () => pad(d.getUTCMilliseconds(), 3),
    A: () => (d.getUTCHours() < 12 ? 'AM' : 'PM'),
    ZZ: () => offsetText.replace(':', ''),
    Z: () => offsetText,
    X: () => String(Math.floor(date.getTime() / 1000)),
    x: () => String(date.getTime()),
  };
  return pattern.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|SSS|A|ZZ|Z|X|x/g,
    (match, literal) => (literal !== undefined ? literal : tokens[match]()),
  );
}

const NAMED_FORMATS = {
  iso: (date, zone) => formatIso(date, zone),
  rfc2822: (date, zone) => formatDate(date, 'ddd, DD MMM YYYY HH:mm:ss ZZ', zone),
  rfc3339: (date, zone) => formatIso(date, zone, { milliseconds: false }),
  http: (date) => date.toUTCString(),
  unix: (date) => String(Math.floor(date.getTime() / 1000)),
  'unix-ms': (date) => String(date.getTime()),
  sql: (date, zone) => formatDate(date, 'YYYY-MM-DD HH:mm:ss', zone),
  human: (date, zone) => formatDate(date, 'dddd, MMMM D, YYYY h:mm A', zone),
};

// ---------------------------------------------------------------- Windows FILETIME
const FILETIME_EPOCH_OFFSET = 116444736000000000n;
export const filetimeToDate = (value) => {
  const ticks = BigInt(String(value).trim());
  return new Date(Number((ticks - FILETIME_EPOCH_OFFSET) / 10000n));
};
export const dateToFiletime = (date) => (BigInt(date.getTime()) * 10000n + FILETIME_EPOCH_OFFSET).toString();

export function relativeTime(date, now = new Date()) {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps = [
    ['year', 31536e6],
    ['month', 2592e6],
    ['week', 6048e5],
    ['day', 864e5],
    ['hour', 36e5],
    ['minute', 6e4],
    ['second', 1e3],
  ];
  for (const [unit, size] of steps)
    if (abs >= size || unit === 'second') return formatter.format(Math.round(diff / size), unit);
  return '';
}

// ---------------------------------------------------------------- Operations
const ZONE_OPTION = { key: 'zone', label: 'Time zone (UTC, local, or IANA)', type: 'text', default: 'UTC' };
const ASSUME_OPTION = { key: 'assume', label: 'Zone for dates without offset', type: 'text', default: 'UTC' };
const UNIT_OPTION = (fallback) => ({
  key: 'unit',
  label: 'Unit',
  type: 'select',
  default: fallback,
  choices: [
    { value: 'auto', label: 'Auto-detect' },
    { value: 's', label: 'Seconds' },
    { value: 'ms', label: 'Milliseconds' },
  ],
});
const ORDER_OPTION = {
  key: 'order',
  label: 'Numeric date order',
  type: 'select',
  default: 'reject',
  choices: [
    { value: 'reject', label: 'Reject ambiguous' },
    { value: 'MDY', label: 'Month/Day/Year' },
    { value: 'DMY', label: 'Day/Month/Year' },
  ],
};

const perLine = (fn) => (input, options) =>
  splitLines(input)
    .map((line) => (line.trim() ? fn(line.trim(), options) : line))
    .join('\n');

export const dateOperations = [
  op({
    id: 'date.unix-to-iso',
    name: 'Unix Timestamp → ISO-8601',
    description: 'Convert Unix seconds or milliseconds (one per line) to ISO-8601 in a time zone.',
    aliases: ['epoch', 'timestamp', 'unix time', 'from unix'],
    inverse: 'date.iso-to-unix',
    options: [UNIT_OPTION('auto'), ZONE_OPTION],
    detect: (text) => /^\d{9,13}$/.test(text.trim()),
    run: perLine((line, { unit, zone }) => {
      if (!/^-?\d+(\.\d+)?$/.test(line)) throw new Error(`Not a Unix timestamp: ${line}`);
      return formatIso(parseDate(line, { unit }), zone);
    }),
  }),
  op({
    id: 'date.iso-to-unix',
    name: 'Date → Unix Timestamp',
    description: 'Convert ISO-8601 or other dates (one per line) to Unix seconds or milliseconds.',
    aliases: ['epoch', 'timestamp', 'to unix'],
    inverse: 'date.unix-to-iso',
    options: [
      {
        ...UNIT_OPTION('s'),
        choices: [
          { value: 's', label: 'Seconds' },
          { value: 'ms', label: 'Milliseconds' },
        ],
      },
      ASSUME_OPTION,
      ORDER_OPTION,
    ],
    run: perLine((line, { unit, assume, order }) => {
      const ms = parseDate(line, { assume, order }).getTime();
      return String(unit === 'ms' ? ms : Math.floor(ms / 1000));
    }),
  }),
  op({
    id: 'date.normalize',
    name: 'Normalize Dates to ISO-8601',
    description: 'Rewrite dates (one per line) as ISO-8601 in a chosen zone.',
    aliases: ['iso date', 'format date', 'utc', 'local time'],
    options: [ZONE_OPTION, ASSUME_OPTION, ORDER_OPTION],
    run: perLine((line, { zone, assume, order }) => formatIso(parseDate(line, { assume, order }), zone)),
  }),
  op({
    id: 'date.format',
    name: 'Format Date',
    description: 'Translate dates to a named format (RFC 2822, HTTP, SQL…) or a custom pattern (YYYY-MM-DD HH:mm).',
    aliases: ['strftime', 'date format', 'rfc2822'],
    options: [
      {
        key: 'format',
        label: 'Format',
        type: 'select',
        default: 'iso',
        choices: [
          { value: 'iso', label: 'ISO-8601' },
          { value: 'rfc3339', label: 'RFC 3339 (no ms)' },
          { value: 'rfc2822', label: 'RFC 2822' },
          { value: 'http', label: 'HTTP date' },
          { value: 'sql', label: 'SQL datetime' },
          { value: 'human', label: 'Human readable' },
          { value: 'unix', label: 'Unix seconds' },
          { value: 'unix-ms', label: 'Unix ms' },
          { value: 'custom', label: 'Custom pattern' },
        ],
      },
      { key: 'pattern', label: 'Custom pattern', type: 'text', default: 'YYYY-MM-DD HH:mm:ss' },
      ZONE_OPTION,
      ASSUME_OPTION,
      ORDER_OPTION,
    ],
    run: perLine((line, { format, pattern, zone, assume, order }) => {
      const date = parseDate(line, { assume, order });
      return format === 'custom' ? formatDate(date, pattern, zone) : NAMED_FORMATS[format](date, zone);
    }),
  }),
  op({
    id: 'date.inspect',
    name: 'Inspect Date',
    description: 'Show a date in UTC, local and a chosen zone, as Unix time, FILETIME and relative to now.',
    aliases: ['what time', 'timestamp info'],
    outputMode: 'report',
    options: [{ key: 'zone', label: 'Extra time zone', type: 'text', default: 'local' }, ASSUME_OPTION, ORDER_OPTION],
    run: (input, { zone, assume, order }) => {
      const date = parseDate(input, { assume, order });
      const rows = [
        ['UTC', formatIso(date, 'UTC')],
        [`Local (${localTimeZone()})`, formatIso(date, 'local')],
        ...(zone && zone !== 'local' && zone !== 'UTC' ? [[zone, formatIso(date, zone)]] : []),
        ['Unix seconds', Math.floor(date.getTime() / 1000)],
        ['Unix milliseconds', date.getTime()],
        ['RFC 2822', formatDate(date, 'ddd, DD MMM YYYY HH:mm:ss ZZ')],
        ['Windows FILETIME', dateToFiletime(date)],
        ['Relative', relativeTime(date)],
      ];
      if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input.trim()) && !/^\d+$/.test(input.trim()))
        rows.push(['⚠️ Note', `No zone in input; interpreted as ${assume}.`]);
      return markdownTable(['Representation', 'Value'], rows);
    },
  }),
  op({
    id: 'date.duration-format',
    name: 'Format Duration',
    description: 'Turn milliseconds/seconds or "90m" into "1h 30m", long words, or ISO-8601 (PT1H30M).',
    aliases: ['duration', 'elapsed', 'humanize'],
    options: [
      {
        key: 'unit',
        label: 'Bare numbers are',
        type: 'select',
        default: 's',
        choices: [
          { value: 's', label: 'Seconds' },
          { value: 'ms', label: 'Milliseconds' },
        ],
      },
      {
        key: 'style',
        label: 'Style',
        type: 'select',
        default: 'short',
        choices: [
          { value: 'short', label: '1h 30m' },
          { value: 'long', label: '1 hour, 30 minutes' },
          { value: 'iso', label: 'ISO-8601 (PT1H30M)' },
        ],
      },
    ],
    run: perLine((line, { unit, style }) => {
      const ms = /^-?\d+(\.\d+)?$/.test(line) ? Number(line) * (unit === 'ms' ? 1 : 1000) : parseDuration(line);
      return formatDuration(ms, { style });
    }),
  }),
  op({
    id: 'date.delta',
    name: 'Difference Between Dates',
    description: 'Time between two dates separated by a --- line.',
    aliases: ['date diff', 'between', 'elapsed'],
    outputMode: 'report',
    options: [ASSUME_OPTION, ORDER_OPTION],
    run: (input, options) => {
      const [a, b] = splitTwoInputs(input).map((part) => parseDate(part.trim(), options));
      const ms = b.getTime() - a.getTime();
      return markdownTable(
        ['Measure', 'Value'],
        [
          ['Duration', formatDuration(ms, { style: 'long' })],
          ['ISO-8601', formatDuration(ms, { style: 'iso' })],
          ['Total days', (ms / 864e5).toFixed(4).replace(/\.?0+$/, '')],
          ['Total hours', (ms / 36e5).toFixed(4).replace(/\.?0+$/, '')],
          ['Total seconds', ms / 1000],
        ],
      );
    },
  }),
  op({
    id: 'date.add',
    name: 'Add/Subtract Duration',
    description: 'Add a duration (e.g. "2d 4h", "-90m", "P1W") to each date.',
    aliases: ['date add', 'date math', 'subtract'],
    options: [
      { key: 'duration', label: 'Duration', type: 'text', default: '1d' },
      ZONE_OPTION,
      ASSUME_OPTION,
      ORDER_OPTION,
    ],
    run: perLine((line, { duration, zone, assume, order }) =>
      formatIso(new Date(parseDate(line, { assume, order }).getTime() + parseDuration(duration)), zone),
    ),
  }),
  op({
    id: 'date.filetime-to-iso',
    name: 'Windows FILETIME → ISO-8601',
    description: 'Convert 100-ns ticks since 1601 to ISO-8601.',
    aliases: ['filetime', 'ntfs', 'ldap timestamp'],
    inverse: 'date.iso-to-filetime',
    run: perLine((line) => formatIso(filetimeToDate(line))),
  }),
  op({
    id: 'date.iso-to-filetime',
    name: 'Date → Windows FILETIME',
    description: 'Convert dates to 100-ns ticks since 1601-01-01 UTC.',
    aliases: ['filetime'],
    inverse: 'date.filetime-to-iso',
    run: perLine((line) => dateToFiletime(parseDate(line))),
  }),
];
