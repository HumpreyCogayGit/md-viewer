import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../registry.js';
import { textOperations } from './index.js';
import * as t from './transforms.js';

const registry = createOperationRegistry(textOperations);
const run = (id, input, options) => registry.execute(id, input, options);

describe('case conversion', () => {
  it('converts identifiers between styles', async () => {
    expect(await run('case.camel', 'user_id\nHTTPServer error')).toBe('userId\nhttpServerError');
    expect(await run('case.pascal', 'get-user-name')).toBe('GetUserName');
    expect(await run('case.snake', 'getUserName')).toBe('get_user_name');
    expect(await run('case.kebab', 'XMLHttpRequest')).toBe('xml-http-request');
    expect(await run('case.constant', 'maxRetryCount')).toBe('MAX_RETRY_COUNT');
    expect(await run('case.dot', 'Some Value')).toBe('some.value');
  });

  it('handles title, sentence and swap case with Unicode', async () => {
    expect(await run('case.title', 'the lord of the rings: a tale')).toBe('The Lord of the Rings: A Tale');
    expect(await run('case.title', 'élan vital')).toBe('Élan Vital');
    expect(await run('case.sentence', 'HELLO WORLD. NEW SENTENCE')).toBe('Hello world. New sentence');
    expect(await run('case.swap', 'aBc É')).toBe('AbC é');
    expect(await run('case.upper', 'straße')).toBe('STRASSE');
  });
});

describe('whitespace and line endings', () => {
  it('trims, collapses and removes blank lines', async () => {
    expect(await run('text.trim', '  a  \n\tb\t')).toBe('a\nb');
    expect(await run('text.trim', '  a  ', { mode: 'end' })).toBe('  a');
    expect(await run('text.collapse-whitespace', '  a   b\t\tc  ')).toBe('  a b c');
    expect(await run('text.remove-blank-lines', 'a\n\n  \nb')).toBe('a\nb');
  });

  it('normalizes line endings both ways and preserves CRLF in line operations', async () => {
    expect(await run('text.line-endings', 'a\r\nb\rc\n', { style: 'lf' })).toBe('a\nb\nc\n');
    expect(await run('text.line-endings', 'a\nb', { style: 'crlf' })).toBe('a\r\nb');
    expect(await run('lines.reverse', 'a\r\nb')).toBe('b\r\na');
  });

  it('converts tabs and spaces using tab stops', async () => {
    expect(await run('text.tabs-to-spaces', 'a\tb\n\tc', { width: 4 })).toBe('a   b\n    c');
    expect(await run('text.spaces-to-tabs', '      x', { width: 4 })).toBe('\t  x');
  });

  it('wraps and unwraps paragraphs', async () => {
    expect(await run('text.wrap', 'one two three four five', { width: 10 })).toBe('one two\nthree four\nfive');
    expect(await run('text.unwrap', 'one\ntwo\n\nthree\nfour')).toBe('one two\n\nthree four');
  });
});

describe('line operations', () => {
  it('sorts naturally, case-insensitively, and descending', async () => {
    expect(await run('lines.sort', 'item10\nItem2\nitem1')).toBe('item1\nItem2\nitem10');
    expect(await run('lines.sort', 'a\nc\nb', { order: 'desc' })).toBe('c\nb\na');
  });

  it('dedupes with optional case sensitivity', async () => {
    expect(await run('lines.dedupe', 'a\nA\na')).toBe('a\nA');
    expect(await run('lines.dedupe', 'a\nA\na', { caseSensitive: false })).toBe('a');
  });

  it('shuffles deterministically with an injected random source', () => {
    expect(t.shuffleLines('a\nb\nc', { random: () => 0 })).toBe('b\nc\na');
  });

  it('prefix/suffix, numbering, head/tail, filter, pad', async () => {
    expect(await run('lines.prefix-suffix', 'a\n\nb', { prefix: '> ', suffix: ';' })).toBe('> a;\n\n> b;');
    expect(await run('lines.number', 'a\nb', { start: 9 })).toBe(' 9. a\n10. b');
    expect(await run('lines.unnumber', ' 9. a\n10) b\n11\tc')).toBe('a\nb\nc');
    expect(await run('lines.head', '1\n2\n3', { count: 2 })).toBe('1\n2');
    expect(await run('lines.tail', '1\n2\n3', { count: 2 })).toBe('2\n3');
    expect(await run('lines.tail', '1\n2', { count: 0 })).toBe('');
    expect(await run('lines.filter', 'apple\nBanana\ncherry', { pattern: 'an' })).toBe('Banana');
    expect(await run('lines.filter', 'a1\nb2\nc', { pattern: '\\d', regex: true, invert: true })).toBe('c');
    expect(await run('lines.pad', 'ab', { width: 4, side: 'start', char: '0' })).toBe('00ab');
  });

  it('splits and joins lists', async () => {
    expect(await run('text.split', 'a, b ,c')).toBe('a\nb\nc');
    expect(await run('text.split', 'a\tb', { delimiter: '\\t' })).toBe('a\nb');
    expect(await run('text.join', 'a\n\nb', { delimiter: ' | ' })).toBe('a | b');
  });

  it('runs set operations on two lists', async () => {
    const input = 'a\nb\nc\n---\nb\nc\nd';
    expect(await run('lines.set-operation', input, { op: 'union' })).toBe('a\nb\nc\nd');
    expect(await run('lines.set-operation', input, { op: 'intersection' })).toBe('b\nc');
    expect(await run('lines.set-operation', input, { op: 'difference' })).toBe('a');
    expect(await run('lines.set-operation', input, { op: 'symmetric' })).toBe('a\nd');
    await expect(run('lines.set-operation', 'a\nb')).rejects.toThrow(/---/);
  });
});

describe('find and replace', () => {
  it('replaces literally without interpreting $ patterns', async () => {
    expect(await run('text.find-replace', 'a.b.c', { find: '.', replace: '$&' })).toBe('a$&b$&c');
  });

  it('supports regex with groups, flags, and whole words', async () => {
    expect(
      await run('text.find-replace', 'John Smith', { find: '(\\w+) (\\w+)', replace: '$2, $1', regex: true }),
    ).toBe('Smith, John');
    expect(await run('text.find-replace', 'Cat cat', { find: 'cat', replace: 'dog', caseSensitive: false })).toBe(
      'dog dog',
    );
    expect(await run('text.find-replace', 'cat concat', { find: 'cat', replace: 'dog', wholeWord: true })).toBe(
      'dog concat',
    );
  });

  it('reports invalid patterns and empty find', async () => {
    await expect(run('text.find-replace', 'x', { find: '(', regex: true })).rejects.toThrow(
      /Invalid regular expression/,
    );
    await expect(run('text.find-replace', 'x', { find: '' })).rejects.toThrow(/Enter text/);
  });
});

describe('escaping', () => {
  it('escapes and unescapes JSON strings', async () => {
    expect(await run('escape.json-string', 'He said "hi"\n')).toBe('He said \\"hi\\"\\n');
    expect(await run('unescape.json-string', 'He said \\"hi\\"\\n')).toBe('He said "hi"\n');
    expect(await run('unescape.json-string', '"\\u00e9"')).toBe('é');
    await expect(run('unescape.json-string', '\\x')).rejects.toThrow(/Invalid JSON string/);
  });

  it('quotes for shells and SQL dialects', async () => {
    expect(await run('escape.shell', "it's")).toBe("'it'\\''s'");
    expect(await run('escape.shell', "it's", { dialect: 'powershell' })).toBe("'it''s'");
    expect(await run('escape.shell', 'a&b', { dialect: 'cmd' })).toBe('"a^&b"');
    expect(await run('escape.sql-string', "O'Brien")).toBe("'O''Brien'");
    expect(await run('escape.sql-string', "O'B\\", { dialect: 'mysql' })).toBe("'O\\'B\\\\'");
    expect(await run('escape.sql-string', "a'\n", { dialect: 'postgres-e' })).toBe("E'a\\'\\n'");
  });
});

describe('cleanup', () => {
  it('converts smart characters pasted from word processors', async () => {
    expect(await run('cleanup.smart-to-ascii', '“Hello” — it’s… 5\u00a0km – ok')).toBe('"Hello" -- it\'s... 5 km - ok');
  });

  it('reveals, lists and removes invisible characters', async () => {
    const input = 'a\u200bb\ufeff\nc\u202e';
    expect(await run('cleanup.reveal-invisible', input)).toBe('a⟦U+200B⟧b⟦U+FEFF⟧\nc⟦U+202E⟧');
    expect(await run('cleanup.remove-invisible', input)).toBe('ab\nc');
    expect(await run('analysis.find-invisible', input)).toContain('| U+202E | 2 | 2 |');
    expect(await run('analysis.find-invisible', 'clean')).toBe('No invisible characters found.');
  });

  it('strips ANSI escape codes', async () => {
    expect(await run('cleanup.strip-ansi', '\u001b[31mred\u001b[0m \u001b[1;32mgreen\u001b[39m')).toBe('red green');
  });

  it('normalizes Unicode and removes diacritics', async () => {
    expect((await run('cleanup.unicode-normalize', 'e\u0301', { form: 'NFC' })).length).toBe(1);
    expect(await run('cleanup.unicode-normalize', 'ﬁ', { form: 'NFKC' })).toBe('fi');
    expect(await run('cleanup.remove-diacritics', 'Crème Brûlée Ångström')).toBe('Creme Brulee Angstrom');
  });

  it('strips HTML to text without a DOM', async () => {
    expect(
      await run('cleanup.strip-html', '<p>Hello <b>world</b> &amp; co</p><script>alert(1)</script><p>Bye</p>'),
    ).toBe('Hello world & co\nBye');
  });
});

describe('analysis reports', () => {
  it('counts occurrences', async () => {
    expect(await run('analysis.count-occurrences', 'a\nb\na')).toBe(
      '| Item | Count |\n| --- | --- |\n| a | 2 |\n| b | 1 |',
    );
    expect(await run('analysis.count-occurrences', 'The the cat', { by: 'word', caseSensitive: false })).toContain(
      '| the | 2 |',
    );
  });

  it('computes number statistics', () => {
    expect(t.numberStats('3, 1, 2, 10')).toEqual({
      count: 4,
      sum: 16,
      mean: 4,
      median: 2.5,
      min: 1,
      max: 10,
      stddev: 3.53553390593,
    });
    expect(t.numberStats('1,000 and -2.5')).toMatchObject({ count: 2, sum: 997.5 });
    expect(() => t.numberStats('none')).toThrow(/No numbers/);
  });

  it('computes Levenshtein distance', async () => {
    expect(t.levenshtein('kitten', 'sitting')).toBe(3);
    expect(t.levenshtein('', 'abc')).toBe(3);
    expect(t.levenshtein('🌍a', '🌍b')).toBe(1);
    expect(await run('analysis.levenshtein', 'kitten\n---\nsitting')).toContain('| Edit distance | 3 |');
  });

  it('computes entropy', () => {
    expect(t.characterFrequency('aabb').entropy).toBe(1);
    expect(t.characterFrequency('').entropy).toBe(0);
  });

  it('marks report operations with outputMode report', () => {
    expect(registry.get('analysis.number-stats').outputMode).toBe('report');
  });
});
