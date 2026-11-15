import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOperationRegistry, unwrapResult } from '../registry.js';
import { toText } from '../bytes.js';
import { base32Encode, base64Encode } from '../encoding/codecs.js';
import { developerOperations } from './index.js';
import { cidrInfo, defang, extract, refang } from './network.js';
import { analyzeUuid, decodeJwt, hotp, totp, uuidV4, uuidV7 } from './tokens.js';
import { colorFormats, convertBaseTo, explainCron, parseColor, parseInteger, permissions } from './inspect.js';
import { compress, decompress } from './compression.js';
import { minifyCss, minifyHtml } from './code.js';
import { generatePassword, loremIpsum, qrCodeSvg, randomString, secureRandomInt } from './generators.js';

const registry = createOperationRegistry(developerOperations);
const run = async (id, input, options) => toText(unwrapResult(await registry.execute(id, input, options)).output);

describe('extractors', () => {
  const text =
    'Visit https://example.com/a?b=1, mail bob@example.org or ALICE@test.io. ' +
    'Hosts 10.0.0.1 and 192.168.1.256 (invalid), v6 2001:db8::1 and fe80::1. MAC 00:1A:2B:3C:4D:5E. ' +
    'On 2024-01-02T10:00:00Z see /var/log/app.log and C:\\Temp\\x.txt; sha d41d8cd98f00b204e9800998ecf8427e. Again https://example.com/a?b=1.';

  it('extracts each kind', () => {
    expect(extract(text, 'urls')).toEqual(['https://example.com/a?b=1']);
    expect(extract(text, 'emails')).toEqual(['bob@example.org', 'ALICE@test.io']);
    expect(extract(text, 'ipv4')).toEqual(['10.0.0.1']);
    expect(extract(text, 'ipv6')).toEqual(['2001:db8::1', 'fe80::1']);
    expect(extract(text, 'mac')).toEqual(['00:1A:2B:3C:4D:5E']);
    expect(extract(text, 'dates')).toEqual(['2024-01-02T10:00:00Z']);
    expect(extract(text, 'paths')).toEqual(expect.arrayContaining(['/var/log/app.log', 'C:\\Temp\\x.txt']));
    expect(extract(text, 'hashes')).toEqual(['d41d8cd98f00b204e9800998ecf8427e']);
    expect(extract(text, 'domains')).toEqual(expect.arrayContaining(['example.com', 'example.org', 'test.io']));
  });

  it('formats as list, lines or counted table', async () => {
    expect(await run('extract.urls', text, { dedupe: false, format: 'lines' })).toBe(
      'https://example.com/a?b=1\nhttps://example.com/a?b=1',
    );
    expect(await run('extract.urls', text, { format: 'table' })).toContain('| https://example.com/a?b=1 | 2 |');
    expect(await run('extract.emails', 'none')).toBe('No email addresses found.');
  });

  it('extracts regex groups and tests patterns', async () => {
    expect(await run('extract.regex', 'a=1 b=2', { pattern: '(\\w)=(\\d)', group: '2' })).toBe('1\n2');
    expect(await run('extract.regex', 'a=1', { pattern: '(?<k>\\w)=', group: 'k' })).toBe('a');
    expect(await run('regex.test', 'x1 y2', { pattern: '([a-z])(\\d)' })).toContain('| 2 | 3 | y2 | y | 2 |');
    await expect(run('regex.test', 'x', { pattern: '(' })).rejects.toThrow(/Invalid regular expression/);
  });
});

describe('URLs, IPs and defanging', () => {
  it('parses URLs into a table with query parameters', async () => {
    const report = await run('url.parse', 'https://user:pw@example.com:8443/a%20b?q=1&q=2#top');
    expect(report).toContain('| Port | 8443 |');
    expect(report).toContain('| Path | /a b |');
    expect(report).toContain('| Password | •••• |');
    expect(report).toContain('| q | 2 |');
    await expect(run('url.parse', 'not a url')).rejects.toThrow(/valid absolute URL/);
  });

  it('validates URLs and rejects dangerous schemes', async () => {
    expect(await run('url.validate', 'https://ok.com\njavascript:alert(1)\nhttp://intranet\nnope')).toBe(
      '✅ https://ok.com\n❌ javascript:alert(1) — scheme "javascript" not allowed\n⚠️ http://intranet — host has no dot\n❌ nope — not a valid absolute URL',
    );
  });

  it('calculates CIDR blocks', () => {
    const report = cidrInfo('192.168.1.10/24');
    expect(report).toContain('| Network | 192.168.1.0 |');
    expect(report).toContain('| Broadcast | 192.168.1.255 |');
    expect(report).toContain('| Usable hosts | 254 |');
    expect(report).toContain('Private');
    expect(cidrInfo('10.0.0.5 255.255.255.252')).toContain('| CIDR | 10.0.0.4/30 |');
    expect(cidrInfo('8.8.8.8/32')).toContain('| Usable hosts | 1 |');
    expect(() => cidrInfo('1.2.3.4/33')).toThrow(/0–32/);
    expect(() => cidrInfo('1.2.3.4 255.0.255.0')).toThrow(/contiguous/);
  });

  it('converts IPv4 formats', async () => {
    const report = await run('ip.formats', '3232235777');
    expect(report).toContain('| Dotted | 192.168.1.1 |');
    expect(report).toContain('| Hex | 0xc0a80101 |');
  });

  it('defangs and refangs indicators', () => {
    const iocs = 'https://evil.example.com/x and 10.1.2.3 and bad@evil.com';
    const defanged = defang(iocs);
    expect(defanged).toBe('hxxps://evil[.]example[.]com/x and 10[.]1[.]2[.]3 and bad[@]evil[.]com');
    expect(refang(defanged)).toBe(iocs);
    expect(refang('hxxp[:]//a(.)b(dot)c')).toBe('http://a.b.c');
  });
});

describe('tokens', () => {
  const header = base64Encode('{"alg":"HS256","typ":"JWT"}', { urlSafe: true, pad: false });
  const payload = base64Encode('{"sub":"42","name":"Zoë","iat":1700000000,"exp":1700003600}', {
    urlSafe: true,
    pad: false,
  });
  const jwt = `${header}.${payload}.c2ln`;

  it('decodes JWT header and claims and warns that the signature is unverified', async () => {
    expect(decodeJwt(`Bearer ${jwt}`).payload.name).toBe('Zoë');
    const report = await run('jwt.decode', jwt);
    expect(report).toContain('has **not** been verified');
    expect(report).toContain('| exp (Expires) | 2023-11-14T23:13:20Z | ⚠️ expired');
    expect(report).toContain('"sub": "42"');
    await expect(run('jwt.decode', 'abc')).rejects.toThrow(/three dot-separated/);
    await expect(run('jwt.decode', 'a.b.c')).rejects.toThrow(/not Base64URL-encoded JSON/);
  });

  it('generates and analyzes UUIDs', () => {
    expect(analyzeUuid(uuidV4())).toMatchObject({ valid: true, version: 4, variant: 'RFC 9562' });
    const v7 = analyzeUuid(uuidV7(1700000000000));
    expect(v7.version).toBe(7);
    expect(v7.timestamp.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(analyzeUuid('c232ab00-9414-11ec-b3c8-9f6bdeced846').timestamp.toISOString()).toBe(
      '2022-02-22T19:22:22.000Z',
    );
    expect(analyzeUuid('00000000-0000-0000-0000-000000000000').variant).toBe('Nil UUID');
    expect(analyzeUuid('nope').valid).toBe(false);
  });

  it('reformats UUIDs', async () => {
    const id = '{C232AB00-9414-11EC-B3C8-9F6BDECED846}';
    expect(await run('uuid.format', id)).toBe('c232ab00-9414-11ec-b3c8-9f6bdeced846');
    expect(await run('uuid.format', id, { style: 'compact' })).toBe('c232ab00941411ecb3c89f6bdeced846');
    expect(await run('uuid.format', 'c232ab00941411ecb3c89f6bdeced846', { style: 'urn' })).toBe(
      'urn:uuid:c232ab00-9414-11ec-b3c8-9f6bdeced846',
    );
    await expect(run('uuid.format', 'xyz')).rejects.toThrow(/Not a UUID/);
    expect(await run('uuid.inspect', 'xyz')).toContain('| xyz | ❌ |');
  });

  it('inspects ObjectIDs', async () => {
    expect(await run('objectid.inspect', 'ObjectId("65538b40e4b0a1b2c3d4e5f6")')).toContain(
      '| Timestamp | 2023-11-14T14:59:12Z |',
    );
  });

  it('computes HOTP/TOTP (RFC 4226 / 6238 vectors)', async () => {
    const secret = new TextEncoder().encode('12345678901234567890');
    expect(await hotp(secret, 0)).toBe('755224');
    expect(await hotp(secret, 9)).toBe('520489');
    expect(await totp(secret, { time: 59_000, digits: 8 })).toBe('94287082');
    expect(await run('otp.totp', base32Encode(secret), { mode: 'hotp', counter: 1 })).toBe(
      'HOTP (counter 1): **287082**',
    );
  });
});

describe('inspectors', () => {
  it('converts number bases with BigInt', async () => {
    expect(parseInteger('0xff')).toBe(255n);
    expect(parseInteger('0b1010')).toBe(10n);
    expect(parseInteger('777', '8')).toBe(511n);
    expect(parseInteger('18446744073709551616')).toBe(2n ** 64n);
    expect(() => parseInteger('12z')).toThrow(/not a valid/);
    expect(await run('number.base-table', '255 -10')).toContain('| 255 | 255 | 0xff | 0o377 | 0b11111111 |');
    expect(convertBaseTo('a=10, b=255', { to: 16 })).toBe('a=0xa, b=0xff');
  });

  it('converts colors', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('hsl(120, 100%, 50%)')).toMatchObject({ r: 0, g: 255, b: 0 });
    const report = colorFormats('#ffffff');
    expect(report).toContain('| HSL | hsl(0 0% 100%) |');
    expect(report).toContain('| Contrast vs black | 21.00:1 |');
    expect(() => parseColor('blue-ish')).toThrow(/Unrecognized color/);
  });

  it('converts units', async () => {
    expect(await run('units.convert', '1 GiB', { to: 'MB' })).toContain('| MB | 1073.741824 |');
    expect(await run('units.convert', '212 F')).toContain('| °C | 100 |');
    expect(await run('units.convert', '1 mi', { to: 'km' })).toContain('| km | 1.609344 |');
    await expect(run('units.convert', '3 parsecs')).rejects.toThrow(/Unknown unit/);
  });

  it('translates file permissions', () => {
    expect(permissions('755')).toContain('| Symbolic | rwxr-xr-x |');
    expect(permissions('-rw-r--r--')).toContain('| Octal | 644 |');
    expect(permissions('4755')).toContain('| Symbolic | rwsr-xr-x |');
    expect(permissions('drwxrwxrwt')).toContain('| Special | sticky |');
    expect(() => permissions('999')).toThrow(/octal/);
  });

  it('explains cron expressions', () => {
    expect(explainCron('*/15 9-17 * * 1-5 /usr/bin/job')).toBe(
      '`*/15 9-17 * * 1-5` — Every 15 minutes, between 09:00 and 17:59, Monday through Friday',
    );
    expect(explainCron('@daily')).toContain('At 00:00');
    expect(() => explainCron('61 * * * *')).toThrow(/Invalid cron/);
  });

  it('parses user agents', async () => {
    const report = await run(
      'useragent.parse',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    );
    expect(report).toContain('| Browser | Safari 17.1 |');
    expect(report).toContain('| OS | iOS 17.1 |');
    expect(report).toContain('| Device | Mobile |');
  });

  it('diffs two texts', async () => {
    const diff = await run('diff.texts', 'a\nb\nc\n---\na\nB\nc');
    expect(diff).toContain('```diff');
    expect(diff).toContain('-b\n+B');
    expect(await run('diff.texts', 'x\n---\nx')).toBe('No differences.');
    expect(await run('diff.texts', 'a\n---\nb\nc', { format: 'summary' })).toBe('2 line(s) added, 1 line(s) removed.');
  });

  it('inspects PEM certificates', async () => {
    const pem = readFileSync(new URL('./fixtures/test-cert.pem', import.meta.url), 'utf8');
    const report = await run('pem.inspect', pem);
    expect(report).toContain('| Subject | CN=speculo.test, O=Speculo Test, C=US |');
    expect(report).toContain('| Serial | 12:34 |');
    expect(report).toContain('| Public key | EC P-256 |');
    expect(report).toContain('| Signature algorithm | ecdsa-with-SHA256 |');
    expect(report).toContain('DNS:speculo.test, DNS:www.speculo.test, IP:127.0.0.1');
    expect(report).toContain(
      '| SHA-256 fingerprint | F2:0D:4B:3C:1A:4F:FD:58:89:7B:C5:01:FA:0C:2A:13:41:42:81:2A:80:02:63:C6:23:7E:20:CD:33:D6:6E:2B |',
    );
    expect(report).toContain('not verified');
    expect(await run('pem.inspect', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toContain(
      'private key',
    );
    await expect(run('pem.inspect', 'nothing')).rejects.toThrow(/No PEM block/);
  });
});

describe('compression', () => {
  it('round-trips gzip, zlib and raw deflate', async () => {
    for (const format of ['gzip', 'deflate', 'deflate-raw']) {
      const packed = await run('compress.gzip', 'héllo '.repeat(100), { format });
      expect(await run('decompress.gzip', packed, { format })).toBe('héllo '.repeat(100));
    }
  });

  it('accepts hex input', async () => {
    const packed = await run('compress.gzip', 'abc', { output: 'hex' });
    expect(await run('decompress.gzip', packed)).toBe('abc');
  });

  it('refuses expansion bombs', async () => {
    const bomb = await compress(new Uint8Array(5_000_000));
    await expect(decompress(bomb, 'gzip', { ratio: 100 })).rejects.toThrow(/expanded/);
    await expect(decompress(bomb, 'gzip', { limit: 1000 })).rejects.toThrow(/limit/);
  });

  it('reports corrupt input', async () => {
    await expect(run('decompress.gzip', base64Encode('not gzip'))).rejects.toThrow(/corrupt/);
  });
});

describe('code formatting', () => {
  it('minifies CSS safely', () => {
    expect(
      minifyCss('/* c */ a  >  b { color : red ; content: " a ; b " ; width: calc(1px + 2px); }\n/*! keep */'),
    ).toBe('a>b{color:red;content:" a ; b ";width:calc(1px + 2px)}/*! keep */');
  });

  it('minifies HTML but keeps <pre> and <script>', () => {
    expect(minifyHtml('<div>\n  <p>Hi</p>  <!-- x -->\n  <pre>  keep\n  me </pre>\n</div>')).toBe(
      '<div><p>Hi</p><pre>  keep\n  me </pre></div>',
    );
  });

  it('beautifies CSS, HTML and JS with the lazily loaded formatter', async () => {
    expect(await run('format.css-beautify', 'a{color:red}')).toBe('a {\n  color: red\n}');
    expect(await run('format.js-beautify', 'function f(){return 1}', { indent: 4 })).toBe(
      'function f() {\n    return 1\n}',
    );
    expect(await run('format.html-beautify', '<div><p>x</p></div>')).toBe('<div>\n  <p>x</p>\n</div>');
  });
});

describe('generators', () => {
  it('are insert-mode operations without input', () => {
    for (const id of [
      'generate.uuid',
      'generate.random-string',
      'generate.password',
      'generate.lorem',
      'generate.timestamp',
    ]) {
      expect(registry.get(id).isGenerator).toBe(true);
      expect(registry.get(id).outputMode).toBe('insert');
    }
  });

  it('generate UUIDs, strings and passwords', async () => {
    const ids = (await run('generate.uuid', '', { count: 3, version: 'v7' })).split('\n');
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => analyzeUuid(id).version === 7)).toBe(true);
    expect(randomString(50, 'ab')).toMatch(/^[ab]{50}$/);
    const password = generatePassword({ length: 12 });
    expect(password).toHaveLength(12);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
    expect(() => generatePassword({ upper: false, lower: false, digits: false, symbols: false })).toThrow(
      /at least one/,
    );
  });

  it('produces unbiased random integers in range', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i += 1) counts[secureRandomInt(3)] += 1;
    expect(Math.min(...counts)).toBeGreaterThan(800);
  });

  it('generates lorem ipsum deterministically with an injected random source', () => {
    expect(loremIpsum({ unit: 'words', count: 4, random: () => 0 })).toBe('lorem ipsum lorem lorem');
    expect(loremIpsum({ unit: 'sentences', count: 1, random: () => 0 })).toBe('Lorem ipsum dolor sit amet lorem.');
  });

  it('inserts timestamps', async () => {
    expect(await run('generate.timestamp', '', { format: 'unix' })).toMatch(/^\d{10}$/);
    expect(await run('generate.timestamp', '', { format: 'date', zone: 'UTC' })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('creates QR codes as SVG data-URI images', async () => {
    expect(qrCodeSvg('hello')).toMatch(/^<svg/);
    expect(await run('generate.qr-code', 'https://example.com')).toMatch(
      /^!\[QR code: https:\/\/example.com\]\(data:image\/svg\+xml;base64,/,
    );
    await expect(run('generate.qr-code', 'x'.repeat(5000))).rejects.toThrow(/too long/);
  });
});
