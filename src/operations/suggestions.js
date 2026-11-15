// Format detection ("magic"). Suggests operations for a selection; never runs anything by itself.
import { isLikelyJson } from './formats/json.js';
import { isLikelyXml } from './formats/xml.js';
import { isLikelySql } from './formats/sql.js';
import { isYaml } from './formats/detect.js';
import { base64Decode, isLikelyBase64 } from './encoding/codecs.js';
import { isValidUtf8 } from './bytes.js';
import { isMarkdownTable } from './markdown/tables.js';
import { looksLikeCsv } from './structuredData/formats.js';
import { parseUuid } from './developer/tokens.js';

const DETECTORS = [
  {
    test: (t) => /^(Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(t),
    suggest: [['jwt.decode', 'Looks like a JSON Web Token']],
  },
  { test: (t) => /-----BEGIN [A-Z ]+-----/.test(t), suggest: [['pem.inspect', 'Contains a PEM block']] },
  {
    test: (t) => parseUuid(t) !== null,
    suggest: [
      ['uuid.inspect', 'Looks like a UUID'],
      ['uuid.format', 'Reformat the UUID'],
    ],
  },
  { test: (t) => /^[0-9a-f]{24}$/i.test(t), suggest: [['objectid.inspect', 'Looks like a MongoDB ObjectID']] },
  {
    test: (t) => /^\d{9,10}(\.\d+)?$/.test(t) || /^\d{12,13}$/.test(t),
    suggest: [['date.unix-to-iso', 'Looks like a Unix timestamp']],
  },
  {
    test: (t) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(t),
    suggest: [
      ['date.inspect', 'Looks like a date'],
      ['date.iso-to-unix', 'Convert to Unix time'],
    ],
  },
  {
    test: (t) => /^(\S+\s+){4}\S+(\s+\S+)?$/.test(t) && /^[\d*/,?LW#-]+\s+[\d*/,?-]+\s/.test(t),
    suggest: [['cron.explain', 'Looks like a cron expression']],
  },
  {
    test: (t) => /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(t),
    suggest: [
      ['url.parse', 'Looks like a URL'],
      ['encode.url', 'Percent-encode it'],
    ],
  },
  {
    test: (t) => /%[0-9a-f]{2}/i.test(t) && !/\s/.test(t.trim()),
    suggest: [['decode.url', 'Contains percent-encoding']],
  },
  {
    test: (t) => /^(?:[^=&\s]+=[^&\s]*)(?:&[^=&\s]+=[^&\s]*)+$/.test(t),
    suggest: [['data.querystring-to-json', 'Looks like a query string']],
  },
  {
    test: (t) => /\\u[0-9a-f]{4}|\\x[0-9a-f]{2}/i.test(t),
    suggest: [
      ['decode.unicode-escape', 'Contains escape sequences'],
      ['decode.string-escape', 'Unescape string'],
    ],
  },
  {
    test: (t) => /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(t),
    suggest: [['decode.html-entities', 'Contains HTML entities']],
  },
  { test: (t) => /\u001b\[/.test(t), suggest: [['cleanup.strip-ansi', 'Contains terminal colour codes']] },
  { test: (t) => /[​-‏‪-‮⁠-⁤﻿]/.test(t), suggest: [['cleanup.reveal-invisible', 'Contains invisible characters']] },
  { test: (t) => /[‘’“”–—… ]/.test(t), suggest: [['cleanup.smart-to-ascii', 'Contains smart quotes or dashes']] },
  {
    test: (t) => /^(?:[0-9a-f]{2}[\s:]?){4,}$/i.test(t) && t.replace(/[\s:]/g, '').length % 2 === 0,
    suggest: [['decode.hex', 'Looks like hex bytes']],
  },
  {
    test: (t) => {
      if (!isLikelyBase64(t)) return false;
      try {
        return isValidUtf8(base64Decode(t));
      } catch {
        return false;
      }
    },
    suggest: [['decode.base64', 'Decodes from Base64 to readable text']],
  },
  {
    test: (t) => /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i.test(t),
    suggest: [['hash.identify', 'Looks like a hash digest']],
  },
  {
    test: (t) => /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^(rgb|hsl)a?\(/i.test(t),
    suggest: [['color.convert', 'Looks like a colour']],
  },
  { test: (t) => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(t), suggest: [['ip.cidr', 'Looks like a CIDR block']] },
  {
    test: isLikelyJson,
    suggest: [
      ['format.json-beautify', 'Valid JSON'],
      ['data.json-to-yaml', 'Convert JSON to YAML'],
      ['json.to-typescript', 'Generate TypeScript types'],
    ],
  },
  {
    test: isLikelyXml,
    suggest: [
      ['format.xml-beautify', 'Valid XML'],
      ['data.xml-to-json', 'Convert XML to JSON'],
    ],
  },
  { test: isLikelySql, suggest: [['format.sql-beautify', 'Looks like SQL']] },
  {
    test: (t) => isMarkdownTable(t),
    suggest: [
      ['table.format', 'Markdown table'],
      ['table.markdown-to-csv', 'Export as CSV'],
    ],
  },
  {
    test: (t) => !isMarkdownTable(t) && looksLikeCsv(t) && /\t/.test(t),
    suggest: [['table.csv-to-markdown', 'Tab-separated (spreadsheet) data → Markdown table']],
  },
  {
    test: (t) => !isMarkdownTable(t) && looksLikeCsv(t),
    suggest: [
      ['data.csv-to-json', 'Looks like CSV'],
      ['table.csv-to-markdown', 'Convert to a Markdown table'],
    ],
  },
  {
    test: (t) => /^\s*<(!doctype|html|body|div|p|span|table|ul|h[1-6])\b/i.test(t) && !isLikelyXml(t),
    suggest: [['md.from-html', 'Looks like HTML']],
  },
  { test: (t) => isYaml(t) && /\n/.test(t), suggest: [['data.yaml-to-json', 'Looks like YAML']] },
];

/**
 * Suggest operations for the given text (most specific first). Returns [{ operationId, reason }].
 * Suggestions are only offered; nothing is executed.
 */
export function suggestOperations(text, { registry, limit = 5 } = {}) {
  const value = String(text || '').trim();
  if (!value || value.length > 200_000) return [];
  const seen = new Set();
  const results = [];
  for (const detector of DETECTORS) {
    let matched;
    try {
      matched = detector.test(value);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    for (const [operationId, reason] of detector.suggest) {
      if (seen.has(operationId) || (registry && !registry.has(operationId))) continue;
      seen.add(operationId);
      results.push({ operationId, reason });
    }
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}
