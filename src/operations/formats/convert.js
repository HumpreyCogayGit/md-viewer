import { JSON_INDENT, parseJson } from './json.js';
import { objectToXml, xmlToObject } from './xml.js';
import { parseYaml, stringifyYaml } from './yaml.js';

export const DATA_FORMAT_LABELS = Object.freeze({ json: 'JSON', xml: 'XML', yaml: 'YAML' });

export function parseDataFormat(code, format) {
  if (format === 'json') return parseJson(code);
  if (format === 'yaml') return parseYaml(code);
  if (format === 'xml') return xmlToObject(code);
  throw new Error(`Unsupported source format: ${format}`);
}

export function stringifyDataFormat(value, format) {
  if (format === 'json') return JSON.stringify(value, null, JSON_INDENT);
  if (format === 'yaml') return stringifyYaml(value);
  if (format === 'xml') return objectToXml(value);
  throw new Error(`Unsupported target format: ${format}`);
}

export function convertDataFormat(code, fromFormat, toFormat) {
  if (fromFormat === toFormat) return String(code).trim();
  return stringifyDataFormat(parseDataFormat(code, fromFormat), toFormat);
}

/** Documented reasons a conversion may not round-trip. */
export const LOSSY_WARNINGS = Object.freeze({
  xml: 'XML comments, processing instructions and namespace declarations are dropped; mixed text is merged; all values become strings; element order can change.',
  yaml: 'YAML comments, anchors, aliases, tags and formatting are lost; several documents become one array.',
  toXml:
    'Keys are converted to valid XML names, arrays become repeated elements, and the result is wrapped in a single root element when needed.',
  jsonNumbers: 'Integers larger than 2^53 lose precision when parsed.',
});

export function conversionWarning(fromFormat, toFormat) {
  const warnings = [];
  if (fromFormat === 'xml') warnings.push(LOSSY_WARNINGS.xml);
  if (fromFormat === 'yaml') warnings.push(LOSSY_WARNINGS.yaml);
  if (toFormat === 'xml') warnings.push(LOSSY_WARNINGS.toXml);
  return warnings.join(' ') || undefined;
}
