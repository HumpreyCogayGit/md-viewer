// Registry-level tests: each operation is executed through the default registry exactly as the UI does.
import { describe, expect, it } from 'vitest';
import { defaultRegistry } from './catalog.js';
import { toText } from './bytes.js';
import { unwrapResult } from './registry.js';
import { validateXml } from './formats/xml.js';

const run = async (id, input, options) =>
  toText(unwrapResult(await defaultRegistry.execute(id, input, options)).output);

describe('format operations through the registry', () => {
  it('minify/beautify SQL, JSON, XML, YAML', async () => {
    expect(await run('format.sql-minify', 'SELECT a,\n  b\nFROM t')).toBe('SELECT a,b FROM t');
    expect(await run('format.json-minify', '{ "a" : [ 1 , 2 ] }')).toBe('{"a":[1,2]}');
    expect(await run('format.xml-beautify', '<a><b>x</b></a>')).toBe('<a>\n    <b>x</b>\n</a>');
    expect(await run('format.xml-minify', '<a>\n  <b>x</b>\n</a>')).toBe('<a><b>x</b></a>');
    expect(await run('format.yaml-beautify', 'a:    1\nb:\n    - x')).toBe('a: 1\nb:\n  - x');
    expect(await run('format.yaml-minify', 'a: 1\nb: [x]')).toBe('{ a: 1, b: [ x ] }');
    expect(await run('format.yaml-repair', 'server:\nport: 80')).toBe('server:\n  port: 80');
    expect(defaultRegistry.get('format.yaml-repair').potentiallyLossy).toBe(true);
    expect(await run('format.css-minify', 'a { color : red ; }')).toBe('a{color:red}');
    expect(await run('format.html-minify', '<p>\n  x\n</p>  <p>y</p>')).toBe('<p> x </p><p>y</p>');
  });

  it('remaining JSON/XML/YAML conversions', async () => {
    const xml = await run('data.json-to-xml', '{"items":[1,2]}');
    expect(validateXml(xml).valid).toBe(true);
    expect(await run('data.xml-to-yaml', '<a><b>1</b></a>')).toBe('a:\n  b: "1"');
  });

  it('JSON tools', async () => {
    expect(await run('json.path', '{"a":[{"b":1},{"b":2}]}', { expression: '$.a[*].b' })).toBe('[\n  1,\n  2\n]');
    expect(await run('json.to-typescript', '{"id":1}')).toBe('export interface Root {\n  id: number;\n}');
    expect(JSON.parse(await run('json.to-schema', '{"a":"x"}')).properties.a.type).toBe('string');
  });
});

describe('markdown operations through the registry', () => {
  it('toc snippet, slugify, link and reference reports', async () => {
    expect(await run('md.toc-snippet', '# T\n## A\n## B')).toBe('- [A](#a)\n- [B](#b)');
    expect(await run('md.slugify', 'Hello World!\nSecond Line')).toBe('hello-world\nsecond-line');
    expect(await run('md.extract-links', '[a](https://a.com) ![i](i.png)')).toContain(
      '| 1 | image | i | i.png | inline |',
    );
    expect(await run('md.extract-links', 'none')).toBe('No links or images found.');
    expect(await run('md.duplicate-references', '[a]: /1\n[A]: /2')).toContain('| a | 1, 2 | /1, /2 |');
    expect(await run('md.duplicate-references', '[a]: /1')).toBe('✅ No duplicate reference definitions.');
  });

  it('mermaid validation loads mermaid lazily and reports empty documents', async () => {
    expect(await run('md.validate-mermaid', 'no diagrams')).toBe('No mermaid code blocks found.');
  });
});

describe('text, encoding and hashing through the registry', () => {
  it('assorted', async () => {
    expect(await run('decode.mime-header', 'Subject: =?UTF-8?Q?Caf=C3=A9?=')).toBe('Subject: Café');
    expect(await run('case.lower', 'ÀBC')).toBe('àbc');
    expect((await run('lines.shuffle', 'a\nb\nc')).split('\n').sort()).toEqual(['a', 'b', 'c']);
    expect(await run('analysis.char-frequency', 'aab')).toContain('| a | 2 | 66.67 |');
    expect(await run('hash.crc32', '123456789')).toBe('cbf43926');
    expect(await run('hash.adler32', 'Wikipedia')).toBe('11e60398');
  });
});

describe('developer operations through the registry', () => {
  it('network, security writing and conversions', async () => {
    expect(await run('ip.cidr', '10.0.0.0/30')).toContain('| Usable hosts | 2 |');
    expect(await run('security.defang', 'http://a.com')).toBe('hxxp://a[.]com');
    expect(await run('security.refang', 'hxxp://a[.]com')).toBe('http://a.com');
    expect(await run('number.convert-base', 'x = 255', { to: '2' })).toBe('x = 0b11111111');
    expect(await run('color.convert', '#000')).toContain('| HEX | #000000 |');
    expect(await run('unix.permissions', '644')).toContain('| Symbolic | rw-r--r-- |');
    expect(await run('cron.explain', '0 9 * * *')).toBe('`0 9 * * *` — At 09:00, every day');
    expect(await run('binary.protobuf-decode', '08 96 01')).toContain('"varint": 150');
    expect(await run('binary.php-unserialize', 'a:1:{s:1:"k";i:5;}')).toBe('{\n  "k": 5\n}');
  });
});
