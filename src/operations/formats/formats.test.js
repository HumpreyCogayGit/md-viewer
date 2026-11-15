import { describe, expect, it } from 'vitest';
import { formatSql, isLikelySql, minifySql, tokenizeSql } from './sql.js';
import {
  formatJson,
  hasUnsafeNumbers,
  isLikelyJson,
  minifyJson,
  parseJson,
  sortJsonKeys,
  validateJson,
} from './json.js';
import { formatXml, isLikelyXml, minifyXml, objectToXml, validateXml, xmlToObject } from './xml.js';
import { formatYaml, minifyYaml, parseYaml, repairYaml, validateYaml } from './yaml.js';
import { convertDataFormat, conversionWarning, parseDataFormat } from './convert.js';
import { isLikelyDataFormat, isYaml } from './detect.js';

describe('SQL', () => {
  it('keeps multi-character operators intact when beautifying (regression)', () => {
    const output = formatSql(
      "select a || b, c::int, d->>'x', e -> 'y', f <=> g, h := 1 from t where id = $1 and n = :name and m = @name",
    );
    expect(output).toContain('a || b');
    expect(output).toContain('c::int');
    expect(output).toContain("d ->> 'x'");
    expect(output).toContain("e -> 'y'");
    expect(output).toContain('f <=> g');
    expect(output).toContain('h := 1');
    expect(output).toContain('id = $1');
    expect(output).toContain('n = :name');
    expect(output).toContain('m = @name');
    expect(output).not.toMatch(/\| \||: :|- >|\$ 1|: name/);
  });

  it('tokenizes parameters and dollar-quoted strings', () => {
    const types = tokenizeSql('$1 :p @v $$body$$')
      .filter((t) => t.type !== 'space')
      .map((t) => t.type);
    expect(types).toEqual(['parameter', 'parameter', 'parameter', 'string']);
  });

  it('never creates a comment when minifying (regression)', () => {
    expect(minifySql('SELECT 1 - -1 FROM t')).toBe('SELECT 1- -1 FROM t');
    expect(minifySql('SELECT 2 / *x FROM t')).not.toContain('/*');
    expect(minifySql('SELECT a FROM t -- note\nWHERE b = 1')).toBe('SELECT a FROM t -- note\nWHERE b=1');
  });

  it('does not treat prose as SQL (regression)', () => {
    expect(isLikelySql('This is in all cases the end of it')).toBe(false);
    expect(isLikelySql('select * from users')).toBe(true);
    expect(isLikelySql('UPDATE t SET a = 1')).toBe(true);
    expect(isLikelySql('')).toBe(false);
  });

  it('formats a representative query', () => {
    expect(formatSql('select id, name from users where active = true order by name')).toBe(
      'SELECT\n    id,\n    name\nFROM\n    users\nWHERE\n    active = TRUE\nORDER BY\n    name',
    );
    expect(formatSql('   ')).toBe('');
  });
});

describe('JSON', () => {
  it('preserves big integers, number spelling, and duplicate keys (regression)', () => {
    const input = '{"big":12345678901234567890,"f":1.0,"e":1e3,"dup":1,"dup":2}';
    expect(formatJson(input, 2)).toBe(
      '{\n  "big": 12345678901234567890,\n  "f": 1.0,\n  "e": 1e3,\n  "dup": 1,\n  "dup": 2\n}',
    );
    expect(minifyJson(formatJson(input))).toBe(input);
  });

  it('keeps empty containers compact and supports tab indentation', () => {
    expect(formatJson('{"a":[],"b":{}}', '\t')).toBe('{\n\t"a": [],\n\t"b": {}\n}');
    expect(formatJson('[]')).toBe('[]');
  });

  it('handles Unicode and escapes verbatim', () => {
    expect(minifyJson('{ "k" : "é \\u00e9 🌍 \\"q\\"" }')).toBe('{"k":"é \\u00e9 🌍 \\"q\\""}');
  });

  it('reports line and column for syntax errors', () => {
    const result = validateJson('{\n  "a": 1,\n  "b": \n}');
    expect(result.valid).toBe(false);
    expect(result.line).toBe(4);
    expect(result.column).toBe(1);
    expect(validateJson('{"a":1} 2').message).toMatch(/after the end/);
    expect(validateJson('').valid).toBe(false);
    expect(validateJson("{'a':1}").valid).toBe(false);
    expect(validateJson('[1,]').valid).toBe(false);
    expect(validateJson('01').valid).toBe(false);
  });

  it('detects JSON and unsafe numbers', () => {
    expect(isLikelyJson('{"a":1}')).toBe(true);
    expect(isLikelyJson('"just a string"')).toBe(false);
    expect(hasUnsafeNumbers('[9007199254740993]')).toBe(true);
    expect(hasUnsafeNumbers('[1.5, 42]')).toBe(false);
    expect(parseJson(' {"a":1} ')).toEqual({ a: 1 });
  });

  it('sorts keys recursively', () => {
    expect(JSON.stringify(sortJsonKeys({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } }))).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1}',
    );
  });

  it('handles large input', () => {
    const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ i })));
    expect(minifyJson(formatJson(big))).toBe(big);
  });
});

describe('XML', () => {
  it('keeps text-only elements on one line (regression)', () => {
    expect(formatXml('<person><name>John</name><age> 42 </age></person>')).toBe(
      '<person>\n    <name>John</name>\n    <age> 42 </age>\n</person>',
    );
  });

  it('handles > inside attribute values (regression)', () => {
    expect(formatXml('<a><b cond="x > 1">t</b></a>')).toBe('<a>\n    <b cond="x > 1">t</b>\n</a>');
    expect(isLikelyXml('<a x="1>2"/>')).toBe(true);
  });

  it('preserves mixed content, comments, CDATA, and the prolog', () => {
    const xml =
      '<?xml version="1.0"?><doc><!-- c --><p>Hello <b>world</b>!</p><code><![CDATA[a<b]]></code><e/><f></f></doc>';
    expect(formatXml(xml)).toBe(
      '<?xml version="1.0"?>\n<doc>\n    <!-- c -->\n    <p>Hello <b>world</b>!</p>\n    <code><![CDATA[a<b]]></code>\n    <e/>\n    <f></f>\n</doc>',
    );
    expect(minifyXml(formatXml(xml))).toBe(xml);
  });

  it('reports invalid XML with position and rejects multiple roots', () => {
    const result = validateXml('<a>\n<b></a>');
    expect(result.valid).toBe(false);
    expect(result.line).toBe(2);
    expect(validateXml('<a/><b/>').message).toMatch(/one root/);
    expect(validateXml('').valid).toBe(false);
    expect(isLikelyXml('not xml')).toBe(false);
  });

  it('parses XML without DOMParser', () => {
    expect(xmlToObject('<r a="1"><i>1</i><i>2</i><n>x</n></r>')).toEqual({
      r: { '@attributes': { a: '1' }, i: ['1', '2'], n: 'x' },
    });
  });

  it('always produces a single root element (regression)', () => {
    expect(objectToXml([1, 2])).toBe('<root>\n  <item>1</item>\n  <item>2</item>\n</root>');
    expect(objectToXml({ items: [1, 2] })).toBe('<root>\n  <items>1</items>\n  <items>2</items>\n</root>');
    expect(objectToXml({ a: 1, b: 2 })).toBe('<root>\n  <a>1</a>\n  <b>2</b>\n</root>');
    expect(objectToXml({ note: { to: 'A' } })).toBe('<note>\n  <to>A</to>\n</note>');
    expect(objectToXml('x')).toBe('<root>x</root>');
    expect(objectToXml([])).toBe('<root></root>');
    for (const value of [[1, 2], { items: [1, 2] }, { a: 1, b: 2 }, [{ x: [1, 2] }], { 'bad key': '<&>' }]) {
      expect(validateXml(objectToXml(value)).valid).toBe(true);
    }
  });
});

describe('YAML', () => {
  it('never repairs invalid YAML silently (regression)', () => {
    const broken = 'server:\nport: 80\n  host: x';
    expect(() => formatYaml(broken)).toThrow(/Invalid YAML at line/);
  });

  it('offers explicit repair', () => {
    expect(repairYaml('database:\nhost: localhost\nport:5432\n\nlogging:\nlevel: info')).toBe(
      'database:\n  host: localhost\n  port: 5432\n\nlogging:\n  level: info',
    );
    expect(repairYaml('a:\n  b: 1\n c: 2')).toBe('a:\n  b: 1\n  c: 2');
    expect(repairYaml('server:\nport: 80\n  host: x')).toBe('server:\n  port: 80\n  host: x');
    expect(repairYaml('s:\n\tx: 1\nd: |\n  line1\nline2\ne: 3')).toBe('s:\n  x: 1\nd: |\n  line1\n  line2\ne: 3');
    expect(repairYaml('list:\n- a\n- b')).toBe('list:\n  - a\n  - b');
  });

  it('formats while keeping comments', () => {
    expect(formatYaml('a:   1 # one\nb:\n    - x')).toBe('a: 1 # one\nb:\n  - x');
  });

  it('minifies to flow style and handles multiple documents', () => {
    expect(minifyYaml('a: 1\nb: [1, 2]')).toBe('{ a: 1, b: [ 1, 2 ] }');
    expect(parseYaml('a: 1\n---\nb: 2')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reports line and column', () => {
    const result = validateYaml('a: [1, 2\nb: 3');
    expect(result.valid).toBe(false);
    expect(result.line).toBeGreaterThan(0);
    expect(validateYaml('').valid).toBe(false);
  });

  it('detects YAML but not JSON, XML or SQL', () => {
    expect(isYaml('a: 1')).toBe(true);
    expect(isYaml('{"a":1}')).toBe(false);
    expect(isYaml('<a/>')).toBe(false);
    expect(isYaml('plain sentence')).toBe(false);
  });
});

describe('data conversion', () => {
  it('converts in all six directions', () => {
    expect(convertDataFormat('{"a":1}', 'json', 'yaml')).toBe('a: 1');
    expect(convertDataFormat('{"a":1}', 'json', 'xml')).toBe('<a>1</a>');
    expect(convertDataFormat('a: 1', 'yaml', 'json')).toBe('{\n    "a": 1\n}');
    expect(convertDataFormat('a: 1', 'yaml', 'xml')).toBe('<a>1</a>');
    expect(convertDataFormat('<a>1</a>', 'xml', 'json')).toBe('{\n    "a": "1"\n}');
    expect(convertDataFormat('<a>1</a>', 'xml', 'yaml')).toBe('a: "1"');
    expect(convertDataFormat(' x ', 'json', 'json')).toBe('x');
  });

  it('round-trips JSON ↔ YAML losslessly for plain data', () => {
    const json =
      '{\n    "name": "Speculo",\n    "tags": [\n        "md",\n        "é"\n    ],\n    "n": 1.5,\n    "ok": true,\n    "none": null\n}';
    expect(convertDataFormat(convertDataFormat(json, 'json', 'yaml'), 'yaml', 'json')).toBe(json);
  });

  it('documents XML/YAML lossiness with fixtures', () => {
    // Comments and processing instructions are dropped; scalars become strings.
    expect(parseDataFormat('<?pi x?><r><!-- c --><n>1</n></r>', 'xml')).toEqual({ r: { n: '1' } });
    // Namespaces are kept only as prefixed names; xmlns declarations become attributes.
    expect(parseDataFormat('<a:r xmlns:a="u"><a:n>1</a:n></a:r>', 'xml')).toEqual({
      'a:r': { '@attributes': { 'xmlns:a': 'u' }, 'a:n': '1' },
    });
    // Mixed content is merged.
    expect(parseDataFormat('<p>Hi <b>there</b> you</p>', 'xml')).toEqual({ p: { b: 'there', '#text': 'Hiyou' } });
    // YAML comments and anchors are lost.
    expect(convertDataFormat('a: &x 1 # c\nb: *x', 'yaml', 'json')).toBe('{\n    "a": 1,\n    "b": 1\n}');
    // Multi-document YAML is an array.
    expect(convertDataFormat('a: 1\n---\nb: 2', 'yaml', 'json')).toContain('[');
    expect(conversionWarning('xml', 'json')).toMatch(/comments/);
    expect(conversionWarning('json', 'yaml')).toBeUndefined();
  });

  it('throws helpful errors for unsupported formats', () => {
    expect(() => parseDataFormat('x', 'csv')).toThrow(/Unsupported/);
    expect(isLikelyDataFormat('x', 'csv')).toBe(false);
  });
});
