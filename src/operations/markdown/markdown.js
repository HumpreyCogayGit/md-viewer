// Pure Markdown utilities: headings, slugs, TOC, links, references, front matter, lists, wrapping.
import * as YAML from 'yaml';
import { parseFencedBlocks } from '../selection.js';

// ---------------------------------------------------------------- Structure helpers
/** Return a per-line mask marking lines inside fenced code blocks (including the fences). */
export function codeLineMask(markdown) {
  const lines = String(markdown).split('\n');
  const mask = new Array(lines.length).fill(false);
  let offset = 0;
  const starts = lines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return start;
  });
  for (const block of parseFencedBlocks(markdown)) {
    starts.forEach((start, index) => {
      if (start >= block.start && start <= block.end) mask[index] = true;
    });
  }
  return mask;
}

/** GitHub-style heading slug. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, (match) => (match === '_' ? '_' : ''))
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function uniqueSlugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** ATX and setext headings outside code blocks. */
export function extractHeadings(markdown) {
  const lines = String(markdown).split('\n');
  const mask = codeLineMask(markdown);
  const slug = uniqueSlugger();
  const headings = [];
  lines.forEach((line, index) => {
    if (mask[index]) return;
    const atx = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line) || /^ {0,3}(#{1,6})$/.exec(line);
    if (atx) {
      const text = (atx[2] || '').trim();
      headings.push({ level: atx[1].length, text, line: index, slug: slug(text) });
      return;
    }
    const next = lines[index + 1];
    if (
      next !== undefined &&
      !mask[index + 1] &&
      line.trim() &&
      /^ {0,3}(=+|-+)[ \t]*$/.test(next) &&
      !/^\s*([-*+]|\d+[.)])\s/.test(line) &&
      !line.includes('|')
    ) {
      const previousBlank = index === 0 || !lines[index - 1].trim() || /^ {0,3}#/.test(lines[index - 1]);
      if (previousBlank) {
        const text = line.trim();
        headings.push({ level: next.trim()[0] === '=' ? 1 : 2, text, line: index, slug: slug(text), setext: true });
      }
    }
  });
  return headings;
}

// ---------------------------------------------------------------- Table of contents
export const TOC_START = '<!-- toc -->';
export const TOC_END = '<!-- tocstop -->';

const stripInline = (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '');

export function buildToc(markdown, { minLevel = 2, maxLevel = 4, ordered = false } = {}) {
  const headings = extractHeadings(markdown).filter(
    (heading) => heading.level >= minLevel && heading.level <= maxLevel,
  );
  if (headings.length === 0) return '';
  const base = Math.min(...headings.map((heading) => heading.level));
  const counters = [];
  return headings
    .map((heading) => {
      const depth = heading.level - base;
      counters[depth] = (counters[depth] || 0) + 1;
      counters.length = depth + 1;
      const marker = ordered ? `${counters[depth]}.` : '-';
      return `${(ordered ? '   ' : '  ').repeat(depth)}${marker} [${stripInline(heading.text)}](#${heading.slug})`;
    })
    .join('\n');
}

/** Insert or refresh a TOC between <!-- toc --> markers. Without markers, it goes after the first H1 (or at the top). */
export function upsertToc(markdown, options = {}) {
  const text = String(markdown);
  const withoutToc = text.replace(new RegExp(`${TOC_START}[\\s\\S]*?${TOC_END}`), `${TOC_START}\n${TOC_END}`);
  const toc = buildToc(withoutToc, options);
  if (!toc) throw new Error('No headings found in the selected level range.');
  const block = `${TOC_START}\n\n${toc}\n\n${TOC_END}`;
  if (text.includes(TOC_START) && text.includes(TOC_END)) {
    return text.replace(new RegExp(`${TOC_START}[\\s\\S]*?${TOC_END}`), block);
  }
  const h1 = extractHeadings(text).find((heading) => heading.level === 1);
  const lines = text.split('\n');
  const insertAt = h1 ? h1.line + (h1.setext ? 2 : 1) : 0;
  lines.splice(insertAt, 0, ...(insertAt > 0 ? [''] : []), block, '');
  return lines.join('\n').replace(/\n{3,}(?=<!-- toc -->)/, '\n\n');
}

// ---------------------------------------------------------------- Headings
export function shiftHeadings(markdown, { by = 1 } = {}) {
  const lines = String(markdown).split('\n');
  const headings = extractHeadings(markdown);
  for (const heading of headings) {
    const level = heading.level + by;
    if (level < 1 || level > 6) {
      throw new Error(
        `Cannot shift "${heading.text}" from H${heading.level} to H${level}; headings must stay between H1 and H6.`,
      );
    }
  }
  for (const heading of headings) {
    const level = heading.level + by;
    if (heading.setext) {
      if (level <= 2) lines[heading.line + 1] = (level === 1 ? '=' : '-').repeat(Math.max(3, heading.text.length));
      else {
        lines[heading.line] = `${'#'.repeat(level)} ${heading.text}`;
        lines[heading.line + 1] = null;
      }
    } else {
      lines[heading.line] = lines[heading.line].replace(/^( {0,3})#{1,6}/, `$1${'#'.repeat(level)}`);
    }
  }
  return lines.filter((line) => line !== null).join('\n');
}

// ---------------------------------------------------------------- Links and references
const INLINE_LINK =
  /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>]*>|[^\s)]+(?:\([^)]*\)[^\s)]*)*)(?:\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[((?:\\.|[^\]\\])+)\]:\s*(<[^>]*>|\S+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const AUTOLINK = /<((?:https?|ftp|mailto):[^>\s]+)>/g;

const normalizeLabel = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();

function forEachNonCodeLine(markdown, callback) {
  const lines = String(markdown).split('\n');
  const mask = codeLineMask(markdown);
  lines.forEach((line, index) => {
    if (!mask[index])
      callback(
        line.replace(/`[^`]*`/g, (code) => ' '.repeat(code.length)),
        index,
        line,
      );
  });
}

export function extractReferenceDefinitions(markdown) {
  const definitions = [];
  forEachNonCodeLine(markdown, (line, index) => {
    const match = REFERENCE_DEFINITION.exec(line);
    if (match && !/^\^/.test(match[1]))
      definitions.push({
        label: match[1],
        key: normalizeLabel(match[1]),
        url: match[2].replace(/^<|>$/g, ''),
        title: match[3],
        line: index,
        raw: line,
      });
  });
  return definitions;
}

export function extractLinks(markdown) {
  const links = [];
  const definitions = firstDefinitions(markdown);
  forEachNonCodeLine(markdown, (line, index) => {
    if (REFERENCE_DEFINITION.test(line)) return;
    for (const match of line.matchAll(INLINE_LINK)) {
      links.push({
        type: match[1] ? 'image' : 'link',
        text: match[2],
        url: match[3].replace(/^<|>$/g, ''),
        title: match[4],
        line: index + 1,
        style: 'inline',
      });
    }
    for (const match of line.matchAll(AUTOLINK))
      links.push({ type: 'link', text: match[1], url: match[1], line: index + 1, style: 'autolink' });
    for (const match of line
      .replace(INLINE_LINK, (m) => ' '.repeat(m.length))
      .matchAll(/(!?)\[((?:\\.|[^\]\\])+)\](?:\[((?:\\.|[^\]\\])*)\])?(?![(:])/g)) {
      if (match[2].startsWith('^')) continue;
      const key = normalizeLabel(match[3] || match[2]);
      const definition = definitions.get(key);
      if (definition || match[3] !== undefined)
        links.push({
          type: match[1] ? 'image' : 'link',
          text: match[2],
          url: definition?.url ?? '',
          line: index + 1,
          style: 'reference',
          label: key,
          missing: !definition,
        });
    }
  });
  return links;
}

/** Map of label → definition. CommonMark: when a label is defined twice, the first definition wins. */
function firstDefinitions(markdown) {
  const map = new Map();
  for (const definition of extractReferenceDefinitions(markdown))
    if (!map.has(definition.key)) map.set(definition.key, definition);
  return map;
}

export function findDuplicateReferences(markdown) {
  const groups = new Map();
  for (const definition of extractReferenceDefinitions(markdown)) {
    if (!groups.has(definition.key)) groups.set(definition.key, []);
    groups.get(definition.key).push(definition);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

export function findBrokenAnchors(markdown) {
  const slugs = new Set(extractHeadings(markdown).map((heading) => heading.slug));
  forEachNonCodeLine(markdown, (line) => {
    for (const match of line.matchAll(/<a\s[^>]*(?:id|name)=["']([^"']+)["']/gi)) slugs.add(match[1]);
  });
  return extractLinks(markdown).filter(
    (link) => link.url.startsWith('#') && link.url.length > 1 && !slugs.has(decodeURIComponent(link.url.slice(1))),
  );
}

/** Convert inline links/images to reference style, reusing labels for identical URLs. */
export function inlineToReferenceLinks(markdown) {
  const existing = extractReferenceDefinitions(markdown);
  const byUrl = new Map(
    existing.map((definition) => [`${definition.url} ${definition.title || ''}`, definition.label]),
  );
  const used = new Set(existing.map((definition) => definition.key));
  const added = [];
  let counter = 1;
  const mask = codeLineMask(markdown);
  const lines = String(markdown)
    .split('\n')
    .map((line, index) => {
      if (mask[index]) return line;
      return line.replace(INLINE_LINK, (match, bang, text, rawUrl, title) => {
        const url = rawUrl.replace(/^<|>$/g, '');
        if (url.startsWith('#')) return match;
        const key = `${url} ${title || ''}`;
        let label = byUrl.get(key);
        if (!label) {
          while (used.has(String(counter))) counter += 1;
          label = String(counter);
          used.add(label);
          byUrl.set(key, label);
          added.push(`[${label}]: ${/\s/.test(url) ? `<${url}>` : url}${title ? ` ${title}` : ''}`);
        }
        return `${bang}[${text}][${label}]`;
      });
    });
  if (added.length === 0) return String(markdown);
  return `${lines.join('\n').replace(/\s*$/, '')}\n\n${added.join('\n')}\n`;
}

/** Replace reference links with inline links and remove used definitions. */
export function referenceToInlineLinks(markdown) {
  const definitions = firstDefinitions(markdown);
  const usedKeys = new Set();
  const mask = codeLineMask(markdown);
  const lines = String(markdown).split('\n');
  const output = lines.map((line, index) => {
    if (mask[index] || REFERENCE_DEFINITION.test(line)) return line;
    return line.replace(
      /(!?)\[((?:\\.|[^\]\\])+)\](?:\[((?:\\.|[^\]\\])*)\])?(?![(:])/g,
      (match, bang, text, label) => {
        if (text.startsWith('^')) return match;
        const key = normalizeLabel(label || text);
        const definition = definitions.get(key);
        if (!definition) return match;
        usedKeys.add(key);
        const url = /[\s()]/.test(definition.url) ? `<${definition.url}>` : definition.url;
        return `${bang}[${text}](${url}${definition.title ? ` ${definition.title}` : ''})`;
      },
    );
  });
  return output
    .filter((line, index) => {
      if (mask[index]) return true;
      const match = REFERENCE_DEFINITION.exec(line);
      return !(match && usedKeys.has(normalizeLabel(match[1])));
    })
    .join('\n')
    .replace(/\n{3,}$/g, '\n')
    .replace(/\n+$/, String(markdown).endsWith('\n') ? '\n' : '');
}

export function sortReferenceDefinitions(markdown) {
  const definitions = extractReferenceDefinitions(markdown);
  if (definitions.length === 0) return String(markdown);
  const lines = String(markdown).split('\n');
  const definitionLines = new Set(definitions.map((definition) => definition.line));
  const body = lines
    .filter((_, index) => !definitionLines.has(index))
    .join('\n')
    .replace(/\s*$/, '');
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...definitions]
    .sort((a, b) => collator.compare(a.label, b.label))
    .map((definition) => definition.raw.trim());
  return `${body}\n\n${sorted.join('\n')}\n`;
}

// ---------------------------------------------------------------- Footnotes
export function renumberFootnotes(markdown) {
  const order = new Map();
  const mask = codeLineMask(markdown);
  const lines = String(markdown).split('\n');
  lines.forEach((line, index) => {
    if (mask[index]) return;
    for (const match of line.matchAll(/\[\^([^\]\s]+)\](?!:)/g))
      if (!order.has(match[1])) order.set(match[1], order.size + 1);
  });
  lines.forEach((line, index) => {
    if (mask[index]) return;
    const match = /^\[\^([^\]\s]+)\]:/.exec(line);
    if (match && !order.has(match[1])) order.set(match[1], order.size + 1);
  });
  const renamed = lines.map((line, index) =>
    mask[index] ? line : line.replace(/\[\^([^\]\s]+)\]/g, (match, id) => `[^${order.get(id) ?? id}]`),
  );
  // Move definitions into reference order, keeping each definition's continuation lines.
  const definitions = [];
  const body = [];
  for (let i = 0; i < renamed.length; i += 1) {
    const match = !mask[i] && /^\[\^(\d+)\]:/.exec(renamed[i]);
    if (match) {
      const block = [renamed[i]];
      while (i + 1 < renamed.length && /^( {2,}|\t)\S/.test(renamed[i + 1])) block.push(renamed[++i]);
      definitions.push({ number: Number(match[1]), text: block.join('\n') });
    } else {
      body.push(renamed[i]);
    }
  }
  if (definitions.length === 0) return renamed.join('\n');
  definitions.sort((a, b) => a.number - b.number);
  return `${body.join('\n').replace(/\s*$/, '')}\n\n${definitions.map((definition) => definition.text).join('\n')}\n`;
}

// ---------------------------------------------------------------- Front matter
const FRONT_MATTER = /^(?:\uFEFF)?(---|\+\+\+)\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/;

export function extractFrontMatter(markdown) {
  const match = FRONT_MATTER.exec(String(markdown));
  if (!match) return null;
  return { delimiter: match[1], raw: match[2], body: String(markdown).slice(match[0].length), length: match[0].length };
}

export function frontMatterToJson(markdown, { indent = 2 } = {}) {
  const fm = extractFrontMatter(markdown);
  if (!fm) throw new Error('No front matter found (the document must start with ---).');
  if (fm.delimiter === '+++') throw new Error('TOML front matter (+++) — use TOML → JSON on its contents.');
  const doc = YAML.parseDocument(fm.raw);
  if (doc.errors.length) throw new Error(`Invalid YAML front matter: ${doc.errors[0].message.split('\n')[0]}`);
  return JSON.stringify(doc.toJSON() ?? {}, null, indent);
}

/** Replace (or add) the document's front matter with data given as JSON or YAML. */
export function setFrontMatter(markdown, data) {
  let value;
  const text = String(data).trim();
  try {
    value = JSON.parse(text);
  } catch {
    const doc = YAML.parseDocument(text);
    if (doc.errors.length) throw new Error('Front matter data must be valid JSON or YAML.');
    value = doc.toJSON();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Front matter must be an object (key: value pairs).');
  const yaml = YAML.stringify(value, { lineWidth: 0 }).trim();
  const fm = extractFrontMatter(markdown);
  if (fm) return `---\n${yaml}\n---\n${fm.body}`;
  const body = String(markdown);
  return `---\n${yaml}\n---\n${body && !body.startsWith('\n') ? '\n' : ''}${body}`;
}

/** Turn a JSON/YAML selection into a front matter block. */
export function dataToFrontMatter(data) {
  return setFrontMatter('', data).replace(/\n+$/, '\n');
}

// ---------------------------------------------------------------- Code fences
export const FENCE_LANGUAGE_ALIASES = {
  js: 'javascript',
  node: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  python3: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'console',
  ps1: 'powershell',
  pwsh: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  'c++': 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  cs: 'csharp',
  'c#': 'csharp',
  'f#': 'fsharp',
  kt: 'kotlin',
  rs: 'rust',
  htm: 'html',
  xhtml: 'html',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  tf: 'hcl',
  terraform: 'hcl',
  psql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  plaintext: 'text',
  txt: 'text',
  'objective-c': 'objectivec',
  objc: 'objectivec',
};

export function normalizeFenceLanguages(markdown, { fenceChar = 'keep', defaultLanguage = '' } = {}) {
  const text = String(markdown);
  let output = '';
  let cursor = 0;
  for (const block of parseFencedBlocks(text)) {
    const lower = block.language.toLowerCase();
    const language = FENCE_LANGUAGE_ALIASES[lower] ?? (lower || defaultLanguage);
    const char = fenceChar === 'keep' ? block.fence[0] : fenceChar;
    const fence = char.repeat(Math.max(3, block.fence.length));
    const body =
      block.code === ''
        ? ''
        : `${block.code
            .split('\n')
            .map((line) => (line ? block.indent + line : line))
            .join('\n')}\n`;
    output +=
      text.slice(cursor, block.start) +
      `${block.indent}${fence}${language}${block.infoRest}\n${body}${block.indent}${fence}`;
    cursor = block.end;
  }
  return output + text.slice(cursor);
}

// ---------------------------------------------------------------- Paragraph wrapping
const isStructural = (line) =>
  /^ {0,3}(#{1,6}\s|>|[-*_]{3,}\s*$|\||<\/?[a-z])/i.test(line) ||
  /^\s*\|/.test(line) ||
  /^ {0,3}[=-]+\s*$/.test(line) ||
  /^\s*\$\$/.test(line) ||
  /^ {4,}\S/.test(line) ||
  /^\[[^\]]+\]:/.test(line);
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+(?:\[[ xX]\]\s+)?)/;

/** Wrap paragraphs and list items at a width; code, tables, headings, HTML, math and quotes are left untouched. */
export function wrapMarkdown(markdown, { width = 80 } = {}) {
  const lines = String(markdown).split('\n');
  const mask = codeLineMask(markdown);
  const output = [];
  let paragraph = [];
  let prefix = '';
  let continuation = '';

  const flush = () => {
    if (paragraph.length === 0) return;
    const words = paragraph.join(' ').split(/\s+/).filter(Boolean);
    let line = prefix;
    let hasWord = false;
    for (const word of words) {
      if (hasWord && line.length + 1 + word.length > width) {
        output.push(line);
        line = continuation + word;
      } else {
        line += (hasWord ? ' ' : '') + word;
      }
      hasWord = true;
    }
    output.push(line);
    paragraph = [];
  };

  lines.forEach((line, index) => {
    if (mask[index] || !line.trim() || isStructural(line)) {
      flush();
      output.push(line);
      return;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      prefix = item[1] + item[2] + item[3];
      continuation = ' '.repeat(prefix.length);
      paragraph.push(line.slice(prefix.length));
      return;
    }
    if (paragraph.length === 0) {
      prefix = line.match(/^\s*/)[0];
      continuation = prefix;
    }
    // A hard line break (two trailing spaces or backslash) ends the wrapped run.
    paragraph.push(line.trim());
    if (/( {2,}|\\)$/.test(line)) {
      flush();
      output[output.length - 1] += line.endsWith('\\') ? '' : '  ';
    }
  });
  flush();
  return output.join('\n');
}

// ---------------------------------------------------------------- Lists
const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

export function convertList(markdown, { to = 'bullet', marker = '-' } = {}) {
  const counters = new Map();
  return String(markdown)
    .split('\n')
    .map((line) => {
      const match = LIST_LINE.exec(line);
      if (!match) {
        if (line.trim() && !/^\s/.test(line)) counters.clear();
        if (!line.trim()) return line;
        if (/^\s/.test(line)) return line;
        // Plain lines become list items.
        return convertList(`- ${line}`, { to, marker });
      }
      const [, indent, , task, content] = match;
      const level = indent.length;
      for (const key of counters.keys()) if (key > level) counters.delete(key);
      if (to === 'numbered') {
        const n = (counters.get(level) || 0) + 1;
        counters.set(level, n);
        return `${indent}${n}. ${task || ''}${content}`;
      }
      if (to === 'task') return `${indent}${marker} ${task || '[ ] '}${content}`;
      return `${indent}${marker} ${content}`;
    })
    .join('\n');
}

export function renumberOrderedLists(markdown) {
  const counters = new Map();
  const mask = codeLineMask(markdown);
  return String(markdown)
    .split('\n')
    .map((line, index) => {
      if (mask[index]) return line;
      const match = /^(\s*)(\d+)([.)])(\s+.*)$/.exec(line);
      if (!match) {
        if (line.trim() && !/^\s/.test(line) && !LIST_LINE.test(line)) counters.clear();
        return line;
      }
      const level = match[1].length;
      for (const key of counters.keys()) if (key > level) counters.delete(key);
      const start = counters.has(level) ? counters.get(level) + 1 : Number(match[2]);
      counters.set(level, start);
      return `${match[1]}${start}${match[3]}${match[4]}`;
    })
    .join('\n');
}

export function toggleTasks(markdown, { mode = 'toggle' } = {}) {
  return String(markdown)
    .split('\n')
    .map((line) =>
      line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_, head, state) => {
        const checked = state.toLowerCase() === 'x';
        const next = mode === 'check' ? true : mode === 'uncheck' ? false : !checked;
        return `${head}[${next ? 'x' : ' '}]`;
      }),
    )
    .join('\n');
}

// ---------------------------------------------------------------- Escaping
export const escapeMarkdown = (text) =>
  String(text)
    .replace(/([\\`*_{}[\]()#+!|<>~])/g, '\\$1')
    .replace(/^(\s*)(\d+)\.(\s)/gm, '$1$2\\.$3')
    .replace(/^(\s*)-(\s)/gm, '$1\\-$2');

export const unescapeMarkdown = (text) => String(text).replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1');

// ---------------------------------------------------------------- Plain text & stats
export function markdownToPlainText(markdown) {
  const source = String(markdown).replace(FRONT_MATTER, '');
  const mask = codeLineMask(source);
  return source
    .split('\n')
    .map((line, index) => {
      if (mask[index]) return /^\s*(`{3,}|~{3,})/.test(line) ? null : line;
      return line
        .replace(/^ {0,3}#{1,6}\s+/, '')
        .replace(/^ {0,3}>\s?/, '')
        .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '$1')
        .replace(/^ {0,3}([-*_])(\s*\1){2,}\s*$/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
        .replace(/^\[[^\]]+\]:\s+\S+.*$/, '')
        .replace(/<[^>]+>/g, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
    })
    .filter((line) => line !== null)
    .join('\n')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(markdown) {
  const plain = markdownToPlainText(
    String(markdown)
      .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
      .replace(/\$\$[\s\S]*?\$\$/g, ''),
  );
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [];
  const cjk = (plain.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  return words.length + cjk;
}

export const readingMinutes = (words, wpm = 230) => Math.max(1, Math.round(words / wpm));

export function findMathExpressions(markdown) {
  const expressions = [];
  const mask = codeLineMask(markdown);
  const text = String(markdown)
    .split('\n')
    .map((line, index) => (mask[index] ? '' : line.replace(/`[^`]*`/g, '')))
    .join('\n');
  for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$/g))
    expressions.push({
      expression: match[1].trim(),
      display: true,
      line: text.slice(0, match.index).split('\n').length,
    });
  const inlineText = text.replace(/\$\$[\s\S]+?\$\$/g, (m) => m.replace(/[^\n]/g, ' '));
  for (const match of inlineText.matchAll(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g))
    expressions.push({
      expression: match[1],
      display: false,
      line: inlineText.slice(0, match.index).split('\n').length,
    });
  return expressions;
}
