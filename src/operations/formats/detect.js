import { isLikelyJson } from './json.js';
import { isLikelyXml } from './xml.js';
import { isLikelySql } from './sql.js';
import { isLikelyYaml, looksLikeYaml } from './yaml.js';

export { isLikelyJson, isLikelyXml, isLikelySql };

const otherFormat = (text) => isLikelyJson(text) || isLikelyXml(text) || isLikelySql(text);

export function isYaml(code) {
  return isLikelyYaml(code, otherFormat);
}

export function looksLikeYamlNotOther(code) {
  return looksLikeYaml(code, otherFormat);
}

export function isLikelyDataFormat(code, format) {
  if (format === 'json') return isLikelyJson(code);
  if (format === 'xml') return isLikelyXml(code);
  if (format === 'yaml') return isYaml(code);
  return false;
}
