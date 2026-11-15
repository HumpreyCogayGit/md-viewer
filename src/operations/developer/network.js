import { markdownList, markdownTable, operationFactory } from '../define.js';

// ---------------------------------------------------------------- Extractors
const IPV4 = String.raw`(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV6 = String.raw`(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:|(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}|(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}|(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}|(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:(?::[0-9a-f]{1,4}){1,6}|:(?::[0-9a-f]{1,4}){1,7}|::)`;

export const EXTRACTORS = {
  urls: { label: 'URLs', pattern: /\b(?:https?|ftp|wss?):\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/gi },
  emails: { label: 'Email addresses', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  domains: {
    label: 'Domains',
    pattern:
      /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|dev|app|co|ai|uk|de|fr|jp|cn|au|ca|us|info|biz|me|tv|xyz|[a-z]{2})\b/gi,
  },
  ipv4: { label: 'IPv4 addresses', pattern: new RegExp(`(?<![\\d.])${IPV4}(?![\\d.])`, 'g') },
  ipv6: {
    label: 'IPv6 addresses',
    pattern: new RegExp(`(?<![0-9a-f:])${IPV6}(?![0-9a-f:])`, 'gi'),
    filter: (value) => value.includes(':') && value.length > 2,
  },
  mac: {
    label: 'MAC addresses',
    pattern: /\b(?:[0-9a-f]{2}([:-]))(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}\b|\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/gi,
  },
  dates: {
    label: 'Dates',
    pattern:
      /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/g,
  },
  paths: {
    label: 'File paths',
    pattern: /(?:[A-Za-z]:\\(?:[^\\\s:*?"<>|]+\\)*[^\\\s:*?"<>|]+|(?<![\w:/])(?:~|\.{1,2})?\/(?:[\w.-]+\/)*[\w.-]+)/g,
    clean: (value) => value.replace(/[.,;:)]+$/, ''),
  },
  hashes: {
    label: 'Hash-like strings',
    pattern: /\b(?:[0-9a-f]{128}|[0-9a-f]{96}|[0-9a-f]{64}|[0-9a-f]{56}|[0-9a-f]{40}|[0-9a-f]{32})\b/gi,
  },
};

export function extract(text, kind, { dedupe = true, sort = false } = {}) {
  const extractor = EXTRACTORS[kind];
  if (!extractor) throw new Error(`Unknown extractor: ${kind}`);
  let matches = Array.from(String(text).matchAll(extractor.pattern), (match) =>
    extractor.clean ? extractor.clean(match[0]) : match[0],
  );
  if (extractor.filter) matches = matches.filter(extractor.filter);
  if (dedupe) matches = Array.from(new Set(matches));
  if (sort) matches.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return matches;
}

export function regexExtract(text, { pattern, flags = 'g', group = 0 } = {}) {
  if (!pattern) throw new Error('Enter a regular expression.');
  let regex;
  try {
    regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message}`, { cause: error });
  }
  return Array.from(String(text).matchAll(regex), (match) => {
    const value = /^\d+$/.test(String(group)) ? match[Number(group)] : match.groups?.[group];
    return value ?? '';
  });
}

export function regexTest(text, { pattern, flags = 'g' } = {}) {
  if (!pattern) throw new Error('Enter a regular expression.');
  let regex;
  try {
    regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error.message}`, { cause: error });
  }
  const matches = Array.from(String(text).matchAll(regex));
  if (matches.length === 0) return 'No matches.';
  const groupCount = Math.max(...matches.map((match) => match.length - 1));
  const named = Object.keys(matches[0].groups || {});
  const headers = [
    '#',
    'Index',
    'Match',
    ...Array.from({ length: groupCount }, (_, i) => `$${i + 1}`),
    ...named.map((name) => `<${name}>`),
  ];
  const rows = matches.map((match, i) => [
    i + 1,
    match.index,
    match[0],
    ...Array.from({ length: groupCount }, (_, g) => match[g + 1] ?? ''),
    ...named.map((name) => match.groups?.[name] ?? ''),
  ]);
  return `${matches.length} match${matches.length === 1 ? '' : 'es'}\n\n${markdownTable(headers, rows)}`;
}

// ---------------------------------------------------------------- URLs
export function parseUrlReport(text) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    throw new Error('Not a valid absolute URL.');
  }
  const rows = [
    ['Scheme', url.protocol.replace(/:$/, '')],
    ['Username', url.username],
    ['Password', url.password ? '••••' : ''],
    ['Host', url.hostname],
    ['Port', url.port || `(default${{ 'http:': ' 80', 'https:': ' 443', 'ftp:': ' 21' }[url.protocol] ?? ''})`],
    ['Path', decodeURIComponent(url.pathname)],
    ['Query', url.search],
    ['Fragment', url.hash],
    ['Origin', url.origin],
  ].filter(([, value]) => value !== '');
  const params = Array.from(url.searchParams);
  return [
    markdownTable(['Part', 'Value'], rows),
    params.length ? `\n**Query parameters**\n\n${markdownTable(['Name', 'Value'], params)}` : '',
  ]
    .join('\n')
    .trim();
}

export function validateUrl(text, { allowedSchemes = 'http,https' } = {}) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const value = line.trim();
      try {
        const url = new URL(value);
        const schemes = allowedSchemes
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const scheme = url.protocol.replace(/:$/, '');
        if (schemes.length && !schemes.includes(scheme)) return `❌ ${value} — scheme "${scheme}" not allowed`;
        if (/^https?$/.test(scheme) && !url.hostname.includes('.') && url.hostname !== 'localhost')
          return `⚠️ ${value} — host has no dot`;
        return `✅ ${value}`;
      } catch {
        return `❌ ${value} — not a valid absolute URL`;
      }
    })
    .join('\n');
}

// ---------------------------------------------------------------- Defang / refang
export const defang = (text) =>
  String(text)
    .replace(/\bhttp(s?):\/\//gi, (_, s) => `hxxp${s}://`)
    .replace(/\bftp:\/\//gi, 'fxp://')
    .replace(/@/g, '[@]')
    .replace(/(?<=[A-Za-z0-9-])\.(?=[A-Za-z0-9-]+(?:[./:]|\b))/g, '[.]');

export const refang = (text) =>
  String(text)
    .replace(/\bhxxp(s?)(\[?:\]?)\/\//gi, (_, s) => `http${s}://`)
    .replace(/\bfxp:\/\//gi, 'ftp://')
    .replace(/\[(\.|dot)\]|\((\.|dot)\)|\{(\.|dot)\}/gi, '.')
    .replace(/\[(@|at)\]|\((@|at)\)/gi, '@')
    .replace(/\[:\]/g, ':');

// ---------------------------------------------------------------- IPv4 / CIDR
export function ipv4ToInt(ip) {
  const parts = String(ip).trim().split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255))
    throw new Error(`Invalid IPv4 address: ${ip}`);
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}
export const intToIpv4 = (value) => [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');

/** Accepts dotted, decimal, hex (0x…), or binary (0b… or 32 bits). */
export function parseIpv4Any(text) {
  const value = String(text).trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return ipv4ToInt(value);
  let number;
  if (/^0x[0-9a-f]{1,8}$/i.test(value)) number = parseInt(value, 16);
  else if (/^(0b)?[01]{32}$/.test(value.replace(/[.\s]/g, ''))) number = parseInt(value.replace(/^0b|[.\s]/g, ''), 2);
  else if (/^\d+$/.test(value)) number = Number(value);
  if (number === undefined || number > 0xffffffff) throw new Error(`Invalid IPv4 value: ${text}`);
  return number;
}

export function ipv4Formats(text) {
  const value = parseIpv4Any(text);
  return markdownTable(
    ['Format', 'Value'],
    [
      ['Dotted', intToIpv4(value)],
      ['Decimal', value],
      ['Hex', `0x${value.toString(16).padStart(8, '0')}`],
      [
        'Binary',
        value
          .toString(2)
          .padStart(32, '0')
          .replace(/(.{8})(?!$)/g, '$1.'),
      ],
      ['IPv4-mapped IPv6', `::ffff:${intToIpv4(value)}`],
    ],
  );
}

export function cidrInfo(text) {
  const match = /^\s*([\d.]+)\s*(?:\/\s*(\d{1,2})|\s+([\d.]+))\s*$/.exec(String(text));
  if (!match) throw new Error('Enter CIDR notation like 192.168.1.10/24 (or address and netmask).');
  const address = ipv4ToInt(match[1]);
  let prefix;
  if (match[2] !== undefined) {
    prefix = Number(match[2]);
    if (prefix > 32) throw new Error('Prefix length must be 0–32.');
  } else {
    const mask = ipv4ToInt(match[3]);
    const bits = mask.toString(2).padStart(32, '0');
    if (!/^1*0*$/.test(bits)) throw new Error('Netmask must be contiguous.');
    prefix = bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
  }
  const size = 2 ** (32 - prefix);
  const mask = prefix === 0 ? 0 : 0xffffffff - (size - 1);
  const network = Math.floor(address / size) * size;
  const broadcast = network + size - 1;
  const usable = prefix >= 31 ? size : size - 2;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const privateRanges = [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['100.64.0.0', 10],
  ];
  const scope = privateRanges.find(
    ([base, bits]) => Math.floor(address / 2 ** (32 - bits)) === Math.floor(ipv4ToInt(base) / 2 ** (32 - bits)),
  );
  return markdownTable(
    ['Property', 'Value'],
    [
      ['Address', intToIpv4(address)],
      ['CIDR', `${intToIpv4(network)}/${prefix}`],
      ['Netmask', intToIpv4(mask)],
      ['Wildcard', intToIpv4(0xffffffff - mask)],
      ['Network', intToIpv4(network)],
      ['Broadcast', prefix >= 31 ? '(none)' : intToIpv4(broadcast)],
      ['First host', intToIpv4(first)],
      ['Last host', intToIpv4(last)],
      ['Total addresses', size.toLocaleString('en-US')],
      ['Usable hosts', usable.toLocaleString('en-US')],
      ['Scope', scope ? `Private/special (${scope[0]}/${scope[1]})` : 'Public'],
    ],
  );
}

// ---------------------------------------------------------------- Operations
const network = operationFactory('Network');
const extractors = operationFactory('Extract', { outputMode: 'report' });
const security = operationFactory('Security Writing');
const LIST_OPTIONS = [
  { key: 'dedupe', label: 'Remove duplicates', type: 'boolean', default: true },
  { key: 'sort', label: 'Sort', type: 'boolean', default: false },
  {
    key: 'format',
    label: 'Output',
    type: 'select',
    default: 'list',
    choices: [
      { value: 'list', label: 'Markdown list' },
      { value: 'lines', label: 'One per line' },
      { value: 'table', label: 'Table with counts' },
    ],
  },
];

function renderExtraction(text, kind, { dedupe, sort, format }) {
  const items = extract(text, kind, { dedupe: format === 'table' ? false : dedupe, sort });
  if (items.length === 0) return `No ${EXTRACTORS[kind].label.toLowerCase()} found.`;
  if (format === 'lines') return items.join('\n');
  if (format === 'table') {
    const counts = new Map();
    items.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1));
    const rows = Array.from(counts);
    if (sort) rows.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    return markdownTable([EXTRACTORS[kind].label, 'Count'], rows);
  }
  return markdownList(items);
}

export const networkOperations = [
  ...Object.entries(EXTRACTORS).map(([kind, { label }]) =>
    extractors({
      id: `extract.${kind}`,
      name: `Extract ${label}`,
      description: `Find all ${label.toLowerCase()} in the selection.`,
      aliases: ['extract', 'find all', kind],
      options: LIST_OPTIONS,
      run: (input, options) => renderExtraction(input, kind, options),
    }),
  ),
  extractors({
    id: 'extract.regex',
    name: 'Regex Extract',
    description: 'All matches of a pattern, or one capture group, one per line.',
    aliases: ['grep -o', 'capture group', 'match all'],
    options: [
      { key: 'pattern', label: 'Pattern', type: 'text', default: '' },
      { key: 'flags', label: 'Flags', type: 'text', default: 'g' },
      { key: 'group', label: 'Group (number or name)', type: 'text', default: '0' },
      { key: 'dedupe', label: 'Remove duplicates', type: 'boolean', default: false },
    ],
    run: (input, { dedupe, ...options }) => {
      const matches = regexExtract(input, options);
      return (dedupe ? Array.from(new Set(matches)) : matches).join('\n');
    },
  }),
  extractors({
    id: 'regex.test',
    name: 'Regex Tester',
    description: 'Show every match with its index and capture groups.',
    aliases: ['regex', 'regexp', 'test pattern'],
    options: [
      { key: 'pattern', label: 'Pattern', type: 'text', default: '' },
      { key: 'flags', label: 'Flags', type: 'text', default: 'g' },
    ],
    run: regexTest,
  }),
  network({
    id: 'url.parse',
    name: 'Parse URL',
    description: 'Break a URL into scheme, host, port, path, query parameters and fragment.',
    aliases: ['url parts', 'query params'],
    outputMode: 'report',
    run: parseUrlReport,
  }),
  network({
    id: 'url.validate',
    name: 'Validate URLs',
    description: 'Check each line is a well-formed absolute URL with an allowed scheme.',
    aliases: ['check url', 'link check'],
    category: 'Validate',
    outputMode: 'report',
    options: [{ key: 'allowedSchemes', label: 'Allowed schemes (comma list)', type: 'text', default: 'http,https' }],
    run: validateUrl,
  }),
  network({
    id: 'ip.formats',
    name: 'IPv4 Format Conversion',
    description: 'Show an IPv4 address as dotted, decimal, hex and binary.',
    aliases: ['ip to int', 'ip decimal'],
    outputMode: 'report',
    run: ipv4Formats,
  }),
  network({
    id: 'ip.cidr',
    name: 'CIDR / Subnet Calculator',
    description: 'Network, broadcast, mask, host range and size for an IPv4 CIDR block.',
    aliases: ['subnet', 'netmask', 'ip range'],
    outputMode: 'report',
    run: cidrInfo,
  }),
  security({
    id: 'security.defang',
    name: 'Defang URLs and IPs',
    description: 'Make indicators non-clickable for incident reports (hxxp://, [.], [@]).',
    aliases: ['ioc', 'defang', 'neuter'],
    inverse: 'security.refang',
    run: defang,
  }),
  security({
    id: 'security.refang',
    name: 'Refang URLs and IPs',
    description: 'Restore defanged indicators.',
    aliases: ['ioc', 'refang'],
    inverse: 'security.defang',
    run: refang,
  }),
];
