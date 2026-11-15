import * as YAML from 'yaml';

export const YAML_LANGUAGES = Object.freeze(['yaml', 'yml']);

export class YamlSyntaxError extends SyntaxError {
  constructor(message, line, column) {
    super(line ? `Invalid YAML at line ${line}, column ${column}: ${message}` : `Invalid YAML: ${message}`);
    this.name = 'YamlSyntaxError';
    this.line = line;
    this.column = column;
  }
}

/** Parse all YAML documents. Never repairs input; invalid YAML throws with line and column. */
export function parseYamlDocuments(input) {
  const text = String(input).trim();
  if (!text) throw new YamlSyntaxError('input is empty');
  const docs = YAML.parseAllDocuments(text, { prettyErrors: true });
  if (!Array.isArray(docs) || docs.length === 0) throw new YamlSyntaxError('no YAML documents found');
  const firstError = docs.flatMap((doc) => doc.errors || [])[0];
  if (firstError) {
    const position = firstError.linePos?.[0];
    const message = String(firstError.message || 'parse error')
      .split('\n')[0]
      .replace(/ at line \d+, column \d+:?$/, '');
    throw new YamlSyntaxError(message, position?.line, position?.col);
  }
  return docs;
}

export function validateYaml(text) {
  try {
    parseYamlDocuments(text);
    return { valid: true };
  } catch (error) {
    return { valid: false, message: error.message, line: error.line, column: error.column };
  }
}

export function stripYamlComment(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (quote === '"' && char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

/** Shape-only heuristic: has YAML mapping or sequence lines. `exclude` rejects other formats first. */
export function looksLikeYaml(code, exclude = () => false) {
  const text = String(code).trim();
  if (!text || exclude(text)) return false;
  const meaningfulLines = text
    .split(/\r?\n/)
    .map((line) => stripYamlComment(line).trim())
    .filter(Boolean);
  return meaningfulLines.some((line) => /^-\s+\S/.test(line) || /^[A-Za-z0-9_'".-][^:]*:\s*(?:\S.*)?$/.test(line));
}

/** Looks like YAML and parses without errors. */
export function isLikelyYaml(code, exclude = () => false) {
  return looksLikeYaml(code, exclude) && validateYaml(code).valid;
}

export function formatYaml(yaml) {
  return parseYamlDocuments(yaml)
    .map((doc) => doc.toString({ indent: 2, lineWidth: 80 }).trim())
    .join('\n---\n')
    .trim();
}

/** Flow-style single-line YAML. Lossy: comments, anchors, aliases and tags are not preserved. */
export function minifyYaml(yaml) {
  return parseYamlDocuments(yaml)
    .map((doc) => YAML.stringify(doc.toJSON(), { collectionStyle: 'flow', lineWidth: 0 }).trim())
    .join('\n---\n')
    .trim();
}

/** YAML value(s): one document → its value; several documents → an array (ambiguous with a root sequence). */
export function parseYaml(text) {
  const values = parseYamlDocuments(text).map((doc) => doc.toJSON());
  return values.length === 1 ? values[0] : values;
}

export function stringifyYaml(value) {
  return YAML.stringify(value, { indent: 2, lineWidth: 80 }).trim();
}

// ---------------------------------------------------------------------------------------------
// Explicit "Repair YAML": guesses indentation for common copy/paste damage. It is only ever run on
// request (with a preview), never silently during beautify/convert.

function normalizeYamlSpacing(content) {
  return content
    .replace(/^-(?=\S)/, '- ')
    .replace(/^(-\s+)?([^:#[\]{}"'\s][^:#[\]{}]*?)\s*:(?!\/\/)\s*(.*)$/, (_, listMarker = '', key, value) => {
      const normalizedValue = value.trim();
      return `${listMarker}${key.trim()}:${normalizedValue ? ` ${normalizedValue}` : ''}`;
    });
}

const isEmptyMappingLine = (content) => /^(-\s+)?[^\s:[\]{}#][^:[\]{}]*:$/.test(stripYamlComment(content).trim());
const isBlockScalarStart = (content) => /(?:^-|:)\s*[|>][+-]?\d*\s*(?:#.*)?$/.test(content.trim());

/**
 * Rebuild indentation for YAML damaged by copy/paste:
 * - a line after an empty `key:` that is not indented becomes its child; the implied section continues until a
 *   blank line;
 * - a key whose indentation does not match any open level snaps to the nearest one (ties go to the deeper level);
 * - tabs become two spaces and `key:value` spacing is normalized.
 * Block scalars (| and >) are kept, re-indenting only lines that fell outside the scalar.
 */
export function repairYamlIndentation(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').trim().split('\n');
  const output = [];
  let levels = [0];
  let previous = null; // { indent, content }
  let impliedIndent = null;
  let scalarIndent = null;

  for (const rawLine of lines) {
    const raw = rawLine.trimEnd();
    const content = raw.trim();
    const rawIndent = raw.length - raw.trimStart().length;

    if (!content) {
      output.push('');
      impliedIndent = null;
      scalarIndent = null;
      continue;
    }

    if (scalarIndent !== null) {
      if (rawIndent >= scalarIndent) {
        output.push(raw);
        continue;
      }
      if (!/^(-\s+)?[^\s:]+[^:]*:(\s|$)/.test(content) && !content.startsWith('- ')) {
        output.push(' '.repeat(scalarIndent) + content);
        continue;
      }
      scalarIndent = null;
    }

    if (content.startsWith('#') || content === '---' || content === '...') {
      output.push(raw);
      if (content === '---') {
        levels = [0];
        previous = null;
        impliedIndent = null;
      }
      continue;
    }

    let indent = rawIndent;
    if (previous && isEmptyMappingLine(previous.content) && indent <= previous.indent) {
      indent = previous.indent + 2;
      impliedIndent = indent;
    } else if (impliedIndent !== null && indent < impliedIndent && indent === 0) {
      indent = impliedIndent;
    } else if (
      !(previous && isEmptyMappingLine(previous.content) && indent > previous.indent) &&
      !levels.includes(indent)
    ) {
      indent = levels.reduce((best, level) => {
        const distance = Math.abs(level - indent);
        const bestDistance = Math.abs(best - indent);
        return distance < bestDistance || (distance === bestDistance && level > best) ? level : best;
      }, levels[0]);
    }

    levels = levels.filter((level) => level <= indent);
    if (!levels.includes(indent)) levels.push(indent);

    const normalized = normalizeYamlSpacing(content);
    output.push(' '.repeat(indent) + normalized);
    if (isBlockScalarStart(normalized)) scalarIndent = indent + 2;
    previous = { indent, content: normalized };
  }

  return output.join('\n').trim();
}

/** Repair then validate; throws if the repaired text is still invalid. */
export function repairYaml(text) {
  const repaired = repairYamlIndentation(text);
  parseYamlDocuments(repaired);
  return formatYaml(repaired);
}
