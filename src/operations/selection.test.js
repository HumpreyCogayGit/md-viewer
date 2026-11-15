import { describe, expect, it } from 'vitest';
import { defineOperation } from './registry.js';
import { executeOperationOnSelection, findFencedBlockAt, parseFencedBlocks, renderFencedBlock } from './selection.js';

const upper = defineOperation({
  id: 'test.upper',
  name: 'Upper',
  description: 'Upper-case JSON',
  category: 'Test',
  inputType: 'json',
  outputType: 'json',
  inputLanguages: ['json'],
  supportsFencedBlock: true,
  validate: (input) => input.trim().startsWith('{'),
  run: (input) => input.toUpperCase(),
});

describe('parseFencedBlocks', () => {
  it('recognizes tilde fences, long fences, indented fences, and info strings (regression)', () => {
    const text = [
      '~~~json',
      '{"a":1}',
      '~~~',
      '````json title="x"',
      '{"b":2}',
      '````',
      '- item',
      '    ```json',
      '    {"c":3}',
      '    ```',
    ].join('\n');
    const blocks = parseFencedBlocks(text);
    expect(blocks.map((block) => block.language)).toEqual(['json', 'json', 'json']);
    expect(blocks.map((block) => block.code)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(blocks[1].infoRest).toBe(' title="x"');
    expect(blocks[2].indent).toBe('    ');
  });

  it('requires a closing fence at least as long as the opening fence', () => {
    const text = '````\ncode\n```\nstill code\n````';
    expect(parseFencedBlocks(text)[0].code).toBe('code\n```\nstill code');
  });

  it('ignores unclosed fences and backtick fences with backticks in the info string', () => {
    expect(parseFencedBlocks('```json\n{}')).toEqual([]);
    expect(parseFencedBlocks('``` a`b\nx\n```')).toEqual([]);
  });

  it('finds the block that contains a cursor', () => {
    const text = 'intro\n```js\nx\n```\noutro';
    expect(findFencedBlockAt(text, 9)?.language).toBe('js');
    expect(findFencedBlockAt(text, 1)).toBeNull();
  });

  it('lengthens the fence when output contains the fence sequence', () => {
    const [block] = parseFencedBlocks('```md\nx\n```');
    expect(renderFencedBlock(block, 'a\n```\nb')).toBe('````md\na\n```\nb\n````');
  });
});

describe('executeOperationOnSelection', () => {
  it('transforms only matching blocks, keeping info strings, indentation, and surrounding text', async () => {
    const text = 'before\n  ~~~json title="cfg"\n  {"a":1}\n  ~~~\nmiddle\n```text\nkeep\n```\nafter';
    expect(await executeOperationOnSelection(upper, text)).toBe(
      'before\n  ~~~json title="cfg"\n  {"A":1}\n  ~~~\nmiddle\n```text\nkeep\n```\nafter',
    );
  });

  it('transforms unlabeled blocks that validate', async () => {
    expect(await executeOperationOnSelection(upper, '```\n{"x":1}\n```')).toBe('```\n{"X":1}\n```');
  });

  it('errors when no block matches and leaves input untouched', async () => {
    await expect(executeOperationOnSelection(upper, '```text\nhello\n```')).rejects.toThrow(
      /No matching fenced code block/,
    );
  });

  it('awaits async operations on each block', async () => {
    const asyncOp = defineOperation({ ...upper, run: async (input) => `<${input}>` });
    expect(await executeOperationOnSelection(asyncOp, '```json\n{}\n```\n```json\n{"b":1}\n```')).toBe(
      '```json\n<{}>\n```\n```json\n<{"b":1}>\n```',
    );
  });

  it('rejects operations that do not support selections', async () => {
    const op = defineOperation({ ...upper, supportsSelection: false });
    await expect(executeOperationOnSelection(op, '{}')).rejects.toThrow(/cannot run/);
  });
});
