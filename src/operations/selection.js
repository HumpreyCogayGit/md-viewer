import { runOperation, unwrapResult } from './registry.js';
import { toText } from './bytes.js';

const OPENING_FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

/**
 * Find every closed fenced code block in Markdown text.
 * Supports ``` and ~~~ fences, fences longer than three characters, indented fences (for example inside
 * list items), and info strings such as ```json title="x"```.
 */
export function parseFencedBlocks(text) {
  const blocks = [];
  const lines = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    lines.push({ text: raw.replace(/\r$/, ''), start: offset });
    offset += raw.length + 1;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const opening = OPENING_FENCE.exec(lines[i].text);
    if (!opening) continue;
    const [, indent, fence, rawInfo] = opening;
    const fenceChar = fence[0];
    // Backtick fences cannot have backticks in the info string (CommonMark).
    if (fenceChar === '`' && rawInfo.includes('`')) continue;

    const closingPattern = new RegExp(`^[ \\t]*${fenceChar === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    let closeIndex = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (closingPattern.test(lines[j].text)) {
        closeIndex = j;
        break;
      }
    }
    if (closeIndex === -1) continue;

    const info = rawInfo.trim();
    const language = (info.split(/[\s{]/)[0] || '').toLowerCase();
    const contentLines = lines.slice(i + 1, closeIndex).map((line) => stripIndent(line.text, indent.length));
    const closingLine = lines[closeIndex];
    blocks.push({
      start: lines[i].start,
      end: closingLine.start + closingLine.text.length,
      indent,
      fence,
      info,
      language,
      infoRest: info.slice(language.length),
      code: contentLines.join('\n'),
      closingFence: closingLine.text,
    });
    i = closeIndex;
  }

  return blocks;
}

function stripIndent(line, width) {
  let removed = 0;
  let index = 0;
  while (removed < width && index < line.length && (line[index] === ' ' || line[index] === '\t')) {
    removed += 1;
    index += 1;
  }
  return line.slice(index);
}

function longestRun(text, char) {
  let longest = 0;
  const pattern = char === '`' ? /`+/g : /~+/g;
  for (const run of text.matchAll(pattern)) longest = Math.max(longest, run[0].length);
  return longest;
}

/** Re-create a fenced block with new content, keeping the fence style, indentation, and info string. */
export function renderFencedBlock(block, code, language = block.language) {
  const fenceChar = block.fence[0];
  const fenceLength = Math.max(block.fence.length, longestRun(code, fenceChar) + 1);
  const fence = fenceChar.repeat(fenceLength);
  const body =
    code === ''
      ? ''
      : `${code
          .split('\n')
          .map((line) => (line ? block.indent + line : line))
          .join('\n')}\n`;
  return `${block.indent}${fence}${language || ''}${block.infoRest}\n${body}${block.indent}${fence}`;
}

/** Return the fenced block that contains a cursor position, or null. */
export function findFencedBlockAt(text, position) {
  return parseFencedBlocks(text).find((block) => position >= block.start && position <= block.end) || null;
}

function blockMatchesOperation(operation, block, options) {
  if (operation.inputLanguages?.includes(block.language)) return true;
  if (block.language) return false;
  const detector = operation.detect || operation.validate;
  if (!detector) return false;
  try {
    return Boolean(detector(block.code, options));
  } catch {
    return false;
  }
}

/**
 * Run an operation against an editor selection.
 * - If the operation supports fenced blocks and the selection contains any, only matching blocks are transformed
 *   (match → await → splice); unrelated blocks are preserved byte-for-byte.
 * - Otherwise the whole selection is validated and transformed.
 * Always resolves to text. Rejects without side effects on invalid input.
 */
export async function executeOperationOnSelection(operation, text, options = {}, context = {}) {
  return (await executeOperationDetailed(operation, text, options, context)).text;
}

/** Like executeOperationOnSelection but resolves to { text, warnings }. */
export async function executeOperationDetailed(operation, text, options = {}, context = {}) {
  const warnings = [];
  // context.runner lets callers route work to a Web Worker; it may return a raw result or { output, warnings }.
  const runner = context.runner || runOperation;
  const collect = (result) => {
    const unwrapped = unwrapResult(result);
    warnings.push(...unwrapped.warnings);
    return toText(unwrapped.output);
  };
  if (!operation.supportsSelection) {
    throw new Error(`${operation.name} cannot run on an editor selection.`);
  }

  if (operation.supportsFencedBlock) {
    const blocks = parseFencedBlocks(text);
    if (blocks.length > 0) {
      const replacements = [];
      for (const block of blocks) {
        if (!blockMatchesOperation(operation, block, options)) continue;
        const output = collect(await runner(operation, block.code, options, context));
        replacements.push({
          block,
          rendered: renderFencedBlock(block, output, operation.outputLanguage || block.language),
        });
      }

      if (replacements.length === 0) {
        throw new Error(
          operation.noMatchingBlockMessage || `No matching fenced code block found for ${operation.name}.`,
        );
      }

      let result = '';
      let cursor = 0;
      for (const { block, rendered } of replacements) {
        result += text.slice(cursor, block.start) + rendered;
        cursor = block.end;
      }
      return { text: result + text.slice(cursor), warnings };
    }
  }

  return { text: collect(await runner(operation, text, options, context)), warnings };
}
