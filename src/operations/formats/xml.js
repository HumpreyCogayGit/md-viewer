// Pure-JS XML tools (no DOMParser), so they run in Node tests and Web Workers.
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const XML_LANGUAGES = Object.freeze([
  'xml',
  'xhtml',
  'svg',
  'rss',
  'atom',
  'wsdl',
  'xsd',
  'xsl',
  'xslt',
  'plist',
]);
export const XML_INDENT = '    ';

export class XmlSyntaxError extends SyntaxError {
  constructor(message, line, column) {
    super(line ? `Invalid XML at line ${line}, column ${column}: ${message}` : `Invalid XML: ${message}`);
    this.name = 'XmlSyntaxError';
    this.line = line;
    this.column = column;
  }
}

// Attribute values are matched as quoted strings, so `>` inside an attribute never ends the tag.
const TAG = String.raw`<\/?[A-Za-z_:][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*\/?>`;
const XML_TOKEN = new RegExp(
  [
    '<!--[\\s\\S]*?-->',
    '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
    '<\\?[\\s\\S]*?\\?>',
    '<!DOCTYPE(?:[^[>]|\\[[\\s\\S]*?\\])*>',
    TAG,
    '[^<]+',
    '<',
  ].join('|'),
  'gi',
);

function tokenize(text) {
  return Array.from(text.matchAll(XML_TOKEN), (match) => {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    if (raw.startsWith('<!--')) return { type: 'comment', raw, start, end };
    if (raw.startsWith('<![CDATA[')) return { type: 'cdata', raw, start, end };
    if (raw.startsWith('<?')) return { type: 'pi', raw, start, end };
    if (/^<!DOCTYPE/i.test(raw)) return { type: 'doctype', raw, start, end };
    if (raw.startsWith('</')) return { type: 'close', raw, start, end, name: raw.slice(2).match(/^[^\s>]+/)[0] };
    if (raw.startsWith('<') && raw.length > 1) {
      return { type: raw.endsWith('/>') ? 'self' : 'open', raw, start, end, name: raw.slice(1).match(/^[^\s/>]+/)[0] };
    }
    return { type: 'text', raw, start, end };
  });
}

/** Validate XML and return a lightweight source tree. Throws XmlSyntaxError with line/column. */
export function parseXmlTree(input) {
  const text = String(input).trim();
  if (!text) throw new XmlSyntaxError('input is empty');
  const result = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (result !== true) throw new XmlSyntaxError(result.err.msg, result.err.line, result.err.col);

  const root = { type: 'document', children: [] };
  const stack = [root];
  for (const token of tokenize(text)) {
    const parent = stack[stack.length - 1];
    if (token.type === 'open') {
      const element = { type: 'element', name: token.name, open: token, children: [], start: token.start };
      parent.children.push(element);
      stack.push(element);
    } else if (token.type === 'close') {
      const element = stack.pop();
      if (!element || element.name !== token.name) throw new XmlSyntaxError(`unexpected closing tag </${token.name}>`);
      element.close = token;
      element.end = token.end;
    } else if (token.type === 'self') {
      parent.children.push({
        type: 'element',
        name: token.name,
        open: token,
        selfClosing: true,
        children: [],
        start: token.start,
        end: token.end,
      });
    } else {
      parent.children.push(token);
    }
  }
  if (stack.length !== 1) throw new XmlSyntaxError('unclosed element');
  const rootElements = root.children.filter((node) => node.type === 'element');
  if (rootElements.length !== 1)
    throw new XmlSyntaxError(`expected exactly one root element, found ${rootElements.length}`);
  if (root.children.some((node) => node.type === 'text' && node.raw.trim()))
    throw new XmlSyntaxError('text outside the root element');
  return { text, root };
}

export function validateXml(text) {
  try {
    parseXmlTree(text);
    return { valid: true };
  } catch (error) {
    return { valid: false, message: error.message, line: error.line, column: error.column };
  }
}

export function isLikelyXml(code) {
  const text = String(code).trim();
  if (!text || !/^<[\s\S]*>$/.test(text) || !/<\/?[A-Za-z_][\w:.-]*(?:\s|>|\/)/.test(text)) return false;
  return validateXml(text).valid;
}

const isBlankText = (node) => node.type === 'text' && !node.raw.trim();

function classify(element) {
  const meaningful = element.children.filter((child) => !isBlankText(child));
  if (meaningful.length === 0) return element.children.length === 0 ? 'empty' : 'blank';
  const hasElements = meaningful.some((child) => child.type === 'element');
  const hasText = meaningful.some((child) => child.type === 'text' || child.type === 'cdata');
  if (!hasElements && meaningful.every((child) => child.type === 'text' || child.type === 'cdata')) return 'text';
  if (hasElements && hasText) return 'mixed';
  if (!hasElements) return 'mixed';
  return 'elements';
}

function formatNode(node, depth, source, pad) {
  const indent = pad.repeat(depth);
  if (node.type !== 'element') return `${indent}${node.raw.trim()}`;
  if (node.selfClosing) return `${indent}${node.open.raw}`;
  const kind = classify(node);
  const inner = source.slice(node.open.end, node.close.start);
  if (kind === 'empty' || kind === 'blank') return `${indent}${node.open.raw}${node.close.raw}`;
  // Text-only and mixed content stay exactly as written: whitespace in text can be significant.
  if (kind === 'text') return `${indent}${node.open.raw}${inner}${node.close.raw}`;
  if (kind === 'mixed') return `${indent}${source.slice(node.start, node.end)}`;
  const children = node.children
    .filter((child) => !isBlankText(child))
    .map((child) => formatNode(child, depth + 1, source, pad));
  return [`${indent}${node.open.raw}`, ...children, `${indent}${node.close.raw}`].join('\n');
}

export function formatXml(xml, pad = XML_INDENT) {
  const { text, root } = parseXmlTree(xml);
  return root.children
    .filter((node) => !isBlankText(node))
    .map((node) => formatNode(node, 0, text, pad))
    .join('\n');
}

function minifyNode(node, source) {
  if (node.type !== 'element') return node.type === 'text' ? node.raw.trim() : node.raw;
  if (node.selfClosing) return node.open.raw;
  const kind = classify(node);
  if (kind === 'empty' || kind === 'blank') return node.open.raw + node.close.raw;
  if (kind === 'text') return node.open.raw + source.slice(node.open.end, node.close.start) + node.close.raw;
  if (kind === 'mixed') return source.slice(node.start, node.end);
  return (
    node.open.raw +
    node.children
      .filter((child) => !isBlankText(child))
      .map((child) => minifyNode(child, source))
      .join('') +
    node.close.raw
  );
}

export function minifyXml(xml) {
  const { text, root } = parseXmlTree(xml);
  return root.children
    .filter((node) => !isBlankText(node))
    .map((node) => minifyNode(node, text))
    .join('');
}

const objectParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '@attributes',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: true,
  htmlEntities: false,
});

/**
 * XML → plain object. Lossy by design: comments and processing instructions are dropped, namespaces are kept only
 * as prefixed names, mixed content is merged into `#text`, and every scalar stays a string.
 */
export function xmlToObject(xml) {
  const { text } = parseXmlTree(xml);
  return objectParser.parse(text);
}

export function escapeXmlValue(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toXmlTagName(name, fallback = 'item') {
  const safeName = String(name || fallback).replace(/[^A-Za-z0-9_.:-]/g, '_');
  return /^[A-Za-z_]/.test(safeName) ? safeName : `_${safeName}`;
}

function objectToXmlElement(name, value, indentLevel, pad) {
  const indent = pad.repeat(indentLevel);
  const tagName = toXmlTagName(name);

  if (Array.isArray(value)) {
    return value.map((item) => objectToXmlElement(tagName, item, indentLevel, pad)).join('\n');
  }
  if (value === null || typeof value !== 'object') {
    return `${indent}<${tagName}>${escapeXmlValue(value ?? '')}</${tagName}>`;
  }

  const attributes = value['@attributes'] && typeof value['@attributes'] === 'object' ? value['@attributes'] : {};
  const attributeText = Object.entries(attributes)
    .map(([attrName, attrValue]) => ` ${toXmlTagName(attrName, 'attr')}="${escapeXmlValue(attrValue)}"`)
    .join('');
  const childEntries = Object.entries(value).filter(([key]) => key !== '@attributes' && key !== '#text');
  const text = value['#text'];

  if (childEntries.length === 0) {
    return `${indent}<${tagName}${attributeText}>${escapeXmlValue(text ?? '')}</${tagName}>`;
  }

  const children = childEntries
    .map(([childName, childValue]) => objectToXmlElement(childName, childValue, indentLevel + 1, pad))
    .join('\n');
  const textLine = text !== undefined && text !== '' ? `\n${pad.repeat(indentLevel + 1)}${escapeXmlValue(text)}` : '';
  return `${indent}<${tagName}${attributeText}>${textLine}\n${children}\n${indent}</${tagName}>`;
}

/**
 * Plain object → XML document with exactly one root element.
 * A single-key object whose value is a scalar or object uses that key as the root; arrays, multi-key objects,
 * and single keys holding arrays are wrapped in <root> so the output never has several root elements.
 */
export function objectToXml(value, { rootName = 'root', pad = '  ' } = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).filter((key) => key !== '@attributes' && key !== '#text');
    if (keys.length === 1 && Object.keys(value).length === 1 && !Array.isArray(value[keys[0]])) {
      return objectToXmlElement(keys[0], value[keys[0]], 0, pad);
    }
    return objectToXmlElement(rootName, value, 0, pad);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `<${rootName}></${rootName}>`;
    return `<${rootName}>\n${objectToXmlElement('item', value, 1, pad)}\n</${rootName}>`;
  }
  return objectToXmlElement(rootName, value, 0, pad);
}
