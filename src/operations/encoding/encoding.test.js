import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../registry.js';
import { toText, utf8Encode } from '../bytes.js';
import { encodingOperations } from './index.js';
import * as codec from './codecs.js';

const registry = createOperationRegistry(encodingOperations);
const run = async (id, input, options) => toText(await registry.execute(id, input, options));

const UNICODE = 'Héllo, 世界 🌍 "q" \\ \n\ttab';

describe('round trips through every inverse pair', () => {
  const pairs = encodingOperations.filter((op) => op.inverse && op.id.startsWith('encode.') && op.inverse !== op.id);
  for (const operation of pairs) {
    it(`${operation.id} ↔ ${operation.inverse}`, async () => {
      const sample = ['encode.morse', 'encode.braille'].includes(operation.id)
        ? 'sos 123'
        : operation.id === 'encode.punycode'
          ? 'münchen.de'
          : UNICODE;
      const encoded = await registry.execute(operation.id, sample);
      const decoded = toText(await registry.execute(operation.inverse, toText(encoded)));
      expect(decoded).toBe(operation.id === 'encode.morse' ? 'SOS 123' : sample);
    });
  }

  it('ROT13 and ROT47 are self-inverse', async () => {
    expect(await run('encode.rot13', await run('encode.rot13', UNICODE))).toBe(UNICODE);
    expect(await run('encode.rot47', await run('encode.rot47', UNICODE))).toBe(UNICODE);
    expect(await run('encode.rot13', 'Hello')).toBe('Uryyb');
  });
});

describe('known vectors', () => {
  it('Base64 handles Unicode correctly', async () => {
    expect(await run('encode.base64', '✓ à la mode')).toBe('4pyTIMOgIGxhIG1vZGU=');
    expect(await run('decode.base64', '4pyTIMOgIGxhIG1vZGU=')).toBe('✓ à la mode');
    expect(await run('encode.base64', '')).toBe('');
    expect(await run('encode.base64', 'a', { pad: false })).toBe('YQ');
  });

  it('Base64URL uses the URL-safe alphabet', async () => {
    expect(await run('encode.base64url', 'ûÿ')).toBe('w7vDvw');
    expect(codec.base64Encode(new Uint8Array([251, 255]), { urlSafe: true })).toBe('-_8=');
    expect(Array.from(codec.base64Decode('-_8'))).toEqual([251, 255]);
  });

  it('rejects invalid Base64 without output', async () => {
    await expect(registry.execute('decode.base64', 'abc$')).rejects.toThrow(/Invalid Base64/);
    await expect(registry.execute('decode.base64', 'a')).rejects.toThrow(/Invalid Base64/);
  });

  it('shows binary results as hex instead of corrupting them', async () => {
    expect(await run('decode.base64', '//79')).toBe('ff fe fd');
  });

  it('Base32 / Base58 / Base85 RFC and reference vectors', () => {
    expect(codec.base32Encode('foobar')).toBe('MZXW6YTBOI======');
    expect(toText(codec.base32Decode('mzxw6ytboi'))).toBe('foobar');
    expect(codec.base58Encode('Hello World!')).toBe('2NEpo7TZRRrLZSi2U');
    expect(codec.base58Encode(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(codec.base85Encode('Man ')).toBe('<~9jqo^~>');
    expect(codec.base85Encode(new Uint8Array(4))).toBe('<~z~>');
    expect(() => codec.base32Decode('189')).toThrow(/Base32/);
    expect(() => codec.base58Decode('0OIl')).toThrow(/Base58/);
  });

  it('URL encoding modes', async () => {
    expect(await run('encode.url', 'a b&c=é/')).toBe('a%20b%26c%3D%C3%A9%2F');
    expect(await run('encode.url', 'a b&c', { mode: 'uri', plusForSpace: true })).toBe('a+b&c');
    expect(await run('decode.url', 'a+b%26')).toBe('a b&');
    expect(await run('decode.url', 'a+b', { plusAsSpace: false })).toBe('a+b');
    await expect(registry.execute('decode.url', '%E0%A4%A')).rejects.toThrow(/percent-encoding/);
  });

  it('HTML entities', async () => {
    expect(await run('encode.html-entities', '<a href="x">Tom & Jerry\'s</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
    expect(await run('encode.html-entities', 'é🌍', { mode: 'all' })).toBe('&#233;&#127757;');
    expect(await run('decode.html-entities', '&lt;&eacute;&#233;&#xE9;&copy;&unknown;&#0;')).toBe('<ééé©&unknown;&#0;');
  });

  it('Hex with separators', async () => {
    expect(await run('encode.hex', 'Hi', { separator: ':', uppercase: true })).toBe('48:69');
    expect(await run('decode.hex', '0x48 0x69')).toBe('Hi');
  });

  it('Unicode escapes in several styles', () => {
    expect(codec.unicodeEscape('é🌍')).toBe('\\u00e9\\ud83c\\udf0d');
    expect(codec.unicodeEscape('é🌍', { style: 'es6' })).toBe('\\u{e9}\\u{1f30d}');
    expect(codec.unicodeEscape('é🌍', { style: 'python' })).toBe('\\u00e9\\U0001f30d');
    expect(codec.unicodeEscape('é', { style: 'codepoint' })).toBe('U+00E9');
    expect(codec.unicodeUnescape('\\u00e9\\ud83c\\udf0d \\u{1F600} U+00E9 \\x41')).toBe('é🌍 😀 é A');
  });

  it('String escapes per language', () => {
    expect(codec.escapeString('a"b\n\t\\', { style: 'json' })).toBe('a\\"b\\n\\t\\\\');
    expect(codec.escapeString("it's\x01", { style: 'js', quote: "'" })).toBe("it\\'s\\x01");
    expect(codec.escapeString('é\n', { style: 'c' })).toBe('\\xc3\\xa9\\n');
    expect(codec.escapeString('\v', { style: 'python' })).toBe('\\x0b');
    expect(codec.unescapeString('\\xc3\\xa9 \\u00e9 \\U0001F600 \\101 \\0 \\q')).toBe('é é 😀 A \0 q');
  });

  it('byte bases and char codes', async () => {
    expect(await run('encode.text-to-base', 'A', { base: 'binary' })).toBe('01000001');
    expect(await run('encode.text-to-base', 'é', { base: 'decimal', separator: ',' })).toBe('195,169');
    expect(await run('decode.base-to-text', '0b01000001 01000010', { base: 'binary' })).toBe('AB');
    expect(await run('decode.base-to-text', '101 102', { base: 'octal' })).toBe('AB');
    await expect(registry.execute('decode.base-to-text', '256', { base: 'decimal' })).rejects.toThrow(
      /valid decimal byte/,
    );
    expect(await run('encode.char-codes', 'A🌍', { base: 'hex' })).toBe('0x41 0x1f30d');
    expect(await run('decode.char-codes', '65, 0x1F30D U+00E9')).toBe('A🌍é');
  });

  it('hexdump round-trips and matches hexdump -C layout', () => {
    const dump = codec.toHexdump('Hello, world!\n');
    expect(dump.split('\n')[0]).toBe('00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a        |Hello, world!.|');
    expect(toText(codec.fromHexdump(dump))).toBe('Hello, world!\n');
    const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => i % 256));
    expect(Array.from(codec.fromHexdump(codec.toHexdump(bytes)))).toEqual(Array.from(bytes));
  });

  it('quoted-printable and MIME headers', () => {
    expect(codec.quotedPrintableEncode('café = ok')).toBe('caf=C3=A9 =3D ok');
    expect(toText(codec.quotedPrintableDecode('caf=C3=A9 =\n=3D ok'))).toBe('café = ok');
    expect(codec.quotedPrintableEncode('x'.repeat(100)).split('\n')[0].length).toBeLessThanOrEqual(76);
    expect(codec.decodeMimeEncodedWords('=?UTF-8?B?w6l0w6k=?= =?ISO-8859-1?Q?caf=E9_bar?=')).toBe('étécafé bar');
  });

  it('punycode for whole domains', async () => {
    expect(await run('encode.punycode', 'münchen.de bücher.example')).toBe('xn--mnchen-3ya.de xn--bcher-kva.example');
  });

  it('Morse and Braille', () => {
    expect(codec.morseEncode('SOS help')).toBe('... --- ... / .... . .-.. .--.');
    expect(codec.morseDecode('... --- ...')).toBe('SOS');
    expect(codec.brailleEncode('ab 1')).toBe('⠁⠃⠀⠼⠁');
  });
});

describe('edge cases', () => {
  it('handles empty and large input', async () => {
    expect(await run('encode.hex', '')).toBe('');
    const large = 'x'.repeat(1_000_000);
    expect((await run('decode.base64', await run('encode.base64', large))).length).toBe(1_000_000);
  });

  it('byte operations accept Uint8Array directly (chaining)', async () => {
    expect(await run('encode.hex', utf8Encode('A'))).toBe('41');
  });
});
