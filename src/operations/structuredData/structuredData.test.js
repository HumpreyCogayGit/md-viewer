import { describe, expect, it } from 'vitest';
import { createOperationRegistry, unwrapResult } from '../registry.js';
import { executeOperationDetailed } from '../selection.js';
import { structuredDataOperations } from './index.js';
import { formattingOperations, validationOperations } from './formatting.js';
import { createDataConversionOperations } from '../dataConversionOperations.js';
import * as f from './formats.js';

const registry = createOperationRegistry([
  ...structuredDataOperations,
  ...formattingOperations,
  ...validationOperations,
  ...createDataConversionOperations(),
]);
const run = async (id, input, options) => unwrapResult(await registry.execute(id, input, options)).output;

describe('CSV', () => {
  it('handles quotes, embedded commas and newlines', async () => {
    const csv = 'name,note,n\n"Smith, J","line1\nline2",3\nDoe,"say ""hi""",4.5';
    expect(JSON.parse(await run('data.csv-to-json', csv))).toEqual([
      { name: 'Smith, J', note: 'line1\nline2', n: 3 },
      { name: 'Doe', note: 'say "hi"', n: 4.5 },
    ]);
  });

  it('auto-detects tabs (spreadsheet paste) and semicolons', async () => {
    expect(JSON.parse(await run('data.csv-to-json', 'a\tb\n1\t2'))).toEqual([{ a: 1, b: 2 }]);
    expect(JSON.parse(await run('data.csv-to-json', 'a;b\n1;x'))).toEqual([{ a: 1, b: 'x' }]);
  });

  it('keeps big integers and leading zeros as strings', async () => {
    expect(JSON.parse(await run('data.csv-to-json', 'id,zip\n12345678901234567890,00123'))).toEqual([
      { id: '12345678901234567890', zip: '00123' },
    ]);
  });

  it('round-trips JSON → CSV → JSON for flat data', async () => {
    const json = '[{"a":1,"b":"x, y"},{"a":2,"b":"q\\"r"}]';
    expect(JSON.parse(await run('data.csv-to-json', await run('data.json-to-csv', json)))).toEqual(JSON.parse(json));
  });

  it('flattens nested objects and unions keys', async () => {
    expect(await run('data.json-to-csv', '[{"a":{"b":1}},{"c":[1,2]}]')).toBe('a.b,c\n1,\n,"[1,2]"');
    expect(await run('data.json-to-csv', '[[1,2],[3,4]]', { delimiter: 'tab' })).toBe('1\t2\n3\t4');
    await expect(run('data.json-to-csv', '[]')).rejects.toThrow(/empty/);
  });

  it('converts between CSV and Markdown tables', async () => {
    expect(await run('table.csv-to-markdown', 'a,b\n1,"x|y"')).toBe('| a   | b    |\n| --- | ---- |\n| 1   | x\\|y |');
    expect(await run('table.markdown-to-csv', '| a | b |\n|---|---|\n| 1 | x\\|y |')).toBe('a,b\n1,x|y');
    await expect(run('table.markdown-to-csv', 'not a table')).rejects.toThrow(/Markdown table/);
  });

  it('changes delimiters', async () => {
    expect(await run('data.change-delimiter', 'a,"b,c"\n1,2', { to: 'semicolon' })).toBe('a;b,c\n1;2');
  });
});

describe('JSON Lines, JSON5, TOML', () => {
  it('converts JSON ↔ JSON Lines', async () => {
    expect(await run('data.json-to-jsonl', '[{"a":1},[2]]')).toBe('{"a":1}\n[2]');
    expect(await run('data.jsonl-to-json', '{"a":1}\n\n[2]', { indent: 0 })).toBe('[{"a":1},[2]]');
    await expect(run('data.jsonl-to-json', '{"a":1}\n{bad')).rejects.toThrow(/line 2/);
    await expect(run('data.json-to-jsonl', '{"a":1}')).rejects.toThrow(/array/);
  });

  it('converts JSON5/JSONC to strict JSON', async () => {
    expect(await run('data.json5-to-json', "{\n  // c\n  a: 1, b: 'x',\n  /* d */ c: [1,2,],\n}", { indent: 0 })).toBe(
      '{"a":1,"b":"x","c":[1,2]}',
    );
    await expect(run('data.json5-to-json', '{a:}')).rejects.toThrow(/Invalid JSON5/);
  });

  it('converts TOML ↔ JSON and validates', async () => {
    const toml = 'title = "Speculo"\n\n[owner]\nname = "Ada"\nyears = [1, 2]';
    expect(JSON.parse(await run('data.toml-to-json', toml))).toEqual({
      title: 'Speculo',
      owner: { name: 'Ada', years: [1, 2] },
    });
    expect(await run('data.json-to-toml', '{"a":1,"t":{"b":"x"}}')).toBe('a = 1\n\n[t]\nb = "x"');
    await expect(run('data.json-to-toml', '{"a":null}')).rejects.toThrow(/null/);
    expect(await run('validate.toml', 'a = ')).toMatch(/❌ Invalid TOML/);
    expect(await run('validate.toml', 'a = 1')).toBe('✅ Valid TOML');
    expect(await run('format.toml', 'a=1\nb   =   "x"')).toBe('a = 1\nb = "x"');
  });
});

describe('query strings', () => {
  it('parses repeated, bracketed and nested keys', async () => {
    expect(
      JSON.parse(
        await run('data.querystring-to-json', 'https://x.test/p?a=1&a=2&b[]=x&b[]=y&c[d][e]=z&s=a+b%26c#frag'),
      ),
    ).toEqual({
      a: ['1', '2'],
      b: ['x', 'y'],
      c: { d: { e: 'z' } },
      s: 'a b&c',
    });
    expect(JSON.parse(await run('data.querystring-to-json', 'a=1&a=2', { repeated: 'last' }))).toEqual({ a: '2' });
    expect(JSON.parse(await run('data.querystring-to-json', 'a[b]=1', { nested: false }))).toEqual({ 'a[b]': '1' });
  });

  it('encodes JSON as a query string in several array styles', async () => {
    const json = '{"q":"a b&c","tags":["x","y"],"f":{"min":1}}';
    expect(await run('data.json-to-querystring', json)).toBe('q=a%20b%26c&tags=x&tags=y&f%5Bmin%5D=1');
    expect(await run('data.json-to-querystring', '{"t":[1,2]}', { arrayStyle: 'brackets' })).toBe(
      't%5B%5D=1&t%5B%5D=2',
    );
    expect(await run('data.json-to-querystring', '{"t":[1,2]}', { arrayStyle: 'indices' })).toBe(
      't%5B0%5D=1&t%5B1%5D=2',
    );
  });

  it('round-trips nested data', async () => {
    const json = { a: ['1', '2'], b: { c: 'x y' } };
    const qs = await run('data.json-to-querystring', JSON.stringify(json));
    expect(JSON.parse(await run('data.querystring-to-json', qs))).toEqual(json);
  });
});

describe('.env and properties', () => {
  it('parses .env with quoting, export, comments and warns about duplicates and interpolation', async () => {
    const env = '# comment\nexport A=1\nB="two words\\n"\nC=\'lit $X\'\nD=${HOME}/x # trailing\nA=3';
    const { output, warnings } = unwrapResult(await registry.execute('data.env-to-json', env));
    expect(JSON.parse(output)).toEqual({ A: '3', B: 'two words\n', C: 'lit $X', D: '${HOME}/x' });
    expect(warnings).toEqual([
      'D: contains ${…} interpolation that is not expanded',
      'A: duplicate key, last value kept',
    ]);
  });

  it('surfaces warnings through executeOperationDetailed', async () => {
    const result = await executeOperationDetailed(registry.get('data.env-to-json'), 'A=1\nA=2');
    expect(result.warnings).toEqual(['A: duplicate key, last value kept']);
  });

  it('writes .env and rejects invalid names', async () => {
    expect(await run('data.json-to-env', '{"A":"x y","B":1,"C":""}')).toBe('A="x y"\nB=1\nC=""');
    await expect(run('data.json-to-env', '{"bad-name":1}')).rejects.toThrow(/valid environment variable/);
  });

  it('parses and writes Java properties', async () => {
    const props = 'a.b = 1\nkey\\ with\\ space: v\nmulti = one \\\n    two\n! comment\nu=\\u00e9';
    expect(JSON.parse(unwrapResult(await registry.execute('data.properties-to-json', props)).output)).toEqual({
      'a.b': '1',
      'key with space': 'v',
      multi: 'one two',
      u: 'é',
    });
    expect(await run('data.json-to-properties', '{"a":{"b":"é"},"k k":"v"}')).toBe('a.b=\\u00e9\nk\\ k=v');
  });
});

describe('JSON utilities', () => {
  it('sorts keys without losing values', async () => {
    expect(await run('json.sort-keys', '{"b":1,"a":{"d":2,"c":3}}', { indent: 0 })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('flattens and unflattens', async () => {
    const nested = '{"a":{"b":[1,{"c":2}]},"e":{}}';
    const flat = await run('json.flatten', nested, { indent: 0 });
    expect(flat).toBe('{"a.b.0":1,"a.b.1.c":2,"e":{}}');
    expect(JSON.parse(await run('json.unflatten', flat))).toEqual(JSON.parse(nested));
  });

  it('evaluates JSONPath', () => {
    const doc = {
      store: {
        book: [
          { author: 'A', price: 8 },
          { author: 'B', price: 12 },
        ],
        bike: { price: 20 },
      },
    };
    expect(f.jsonPath(doc, '$.store.book[*].author')).toEqual(['A', 'B']);
    expect(f.jsonPath(doc, '$..price')).toEqual([8, 12, 20]);
    expect(f.jsonPath(doc, '$.store.book[-1].author')).toEqual(['B']);
    expect(f.jsonPath(doc, '$.store.book[0:1]')).toEqual([{ author: 'A', price: 8 }]);
    expect(f.jsonPath(doc, "$['store']['bike']")).toEqual([{ price: 20 }]);
    expect(f.jsonPath(doc, '$.store.book[0,1].price')).toEqual([8, 12]);
    expect(() => f.jsonPath(doc, '$.store.book[?(@.price<10)]')).toThrow(/Filters/);
    expect(() => f.jsonPath(doc, 'store')).toThrow(/start with \$/);
  });

  it('generates TypeScript interfaces with optional fields', () => {
    expect(f.jsonToTypeScript({ id: 1, tags: ['a'], users: [{ name: 'x', age: 2 }, { name: 'y' }] })).toBe(
      'export interface Root {\n  id: number;\n  tags: string[];\n  users: User[];\n}\n\nexport interface User {\n  name: string;\n  age?: number;\n}',
    );
    expect(f.jsonToTypeScript([1, 'a'])).toBe('export type Root = (number | string)[];');
  });

  it('infers a JSON Schema sketch', () => {
    expect(f.jsonToSchema({ a: 1, b: ['x'], c: [{ d: true }, { d: false, e: null }] })).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        a: { type: 'integer' },
        b: { type: 'array', items: { type: 'string' } },
        c: {
          type: 'array',
          items: { type: 'object', properties: { d: { type: 'boolean' }, e: { type: 'null' } }, required: ['d'] },
        },
      },
      required: ['a', 'b', 'c'],
    });
  });
});

describe('real JSON/XML/YAML operations through the registry', () => {
  it('beautifies fenced blocks and reports precise errors for plain selections', async () => {
    const op = registry.get('format.json-beautify');
    expect((await executeOperationDetailed(op, '```json\n{"a":12345678901234567890}\n```')).text).toBe(
      '```json\n{\n    "a": 12345678901234567890\n}\n```',
    );
    await expect(executeOperationDetailed(op, '{"a":}')).rejects.toThrow(/line 1, column 6/);
  });

  it('refuses to beautify prose as SQL (regression)', async () => {
    await expect(registry.execute('format.sql-beautify', 'This is in all cases the end of it')).rejects.toThrow(
      /does not look like SQL/,
    );
  });

  it('converts with the real converters', async () => {
    expect(await run('data.yaml-to-xml', 'items:\n  - 1\n  - 2')).toBe(
      '<root>\n  <items>1</items>\n  <items>2</items>\n</root>',
    );
    expect(await run('data.xml-to-json', '<a x="1">t</a>')).toBe(
      '{\n    "a": {\n        "#text": "t",\n        "@attributes": {\n            "x": "1"\n        }\n    }\n}',
    );
    await expect(run('data.xml-to-json', '<a><b></a>')).rejects.toThrow(/line 1/);
  });

  it('validates with line and column', async () => {
    expect(await run('validate.json', '{"a":1}')).toBe('✅ Valid JSON');
    expect(await run('validate.yaml', 'a: [1')).toMatch(/❌ Invalid YAML at line/);
    expect(await run('validate.xml', '<a>')).toMatch(/❌ Invalid XML/);
  });
});
