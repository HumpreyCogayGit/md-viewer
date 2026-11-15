import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../registry.js';
import { bytesToHex, hexToBytes } from '../bytes.js';
import * as b from './binary.js';

const registry = createOperationRegistry(b.binaryFormatOperations);
const run = (id, input, options) => registry.execute(id, input, options);

const SAMPLE = { s: 'héllo', n: -5, big: 70000, f: 1.5, t: true, z: null, list: [1, 'two', [3]], nested: { k: 'v' } };

describe('MessagePack', () => {
  it('matches spec byte layouts', () => {
    expect(bytesToHex(b.msgpackEncode({ a: 1 }))).toBe('81a16101');
    expect(bytesToHex(b.msgpackEncode([-1, 256, 'x'.repeat(40)]))).toMatch(/^93ffcd0100d928/);
    expect(b.msgpackDecode(hexToBytes('c0c3'.slice(0, 2)))).toBe(null);
  });

  it('round-trips JSON through hex and Base64', async () => {
    for (const encoding of ['hex', 'base64']) {
      const packed = await run('binary.json-to-msgpack', JSON.stringify(SAMPLE), { encoding });
      expect(JSON.parse(await run('binary.msgpack-to-json', packed))).toEqual(SAMPLE);
    }
  });

  it('rejects trailing bytes and truncated input', () => {
    expect(() => b.msgpackDecode(hexToBytes('0101'))).toThrow(/trailing/);
    expect(() => b.msgpackDecode(hexToBytes('92 01'))).toThrow(/end of data/);
  });
});

describe('CBOR', () => {
  it('decodes RFC 8949 appendix A vectors', () => {
    expect(b.cborDecode(hexToBytes('8201820203'))).toEqual([1, [2, 3]]);
    expect(b.cborDecode(hexToBytes('f93e00'))).toBe(1.5);
    expect(b.cborDecode(hexToBytes('3863'))).toBe(-100);
    expect(b.cborDecode(hexToBytes('a26161016162820203'))).toEqual({ a: 1, b: [2, 3] });
    expect(b.cborDecode(hexToBytes('9f018202039f0405ffff'))).toEqual([1, [2, 3], [4, 5]]);
    expect(b.cborDecode(hexToBytes('c11a514b67b0'))).toEqual({ $date: '2013-03-21T20:04:00.000Z' });
    expect(b.cborDecode(hexToBytes('c249010000000000000000'))).toBe('18446744073709551616');
    expect(b.cborDecode(hexToBytes('6449455446'))).toBe('IETF');
  });

  it('round-trips JSON', async () => {
    const packed = await run('binary.json-to-cbor', JSON.stringify(SAMPLE), { encoding: 'hex' });
    expect(JSON.parse(await run('binary.cbor-to-json', packed))).toEqual(SAMPLE);
  });
});

describe('BSON', () => {
  it('matches the bsonspec.org example', () => {
    const hello = '160000000268656c6c6f0006000000776f726c640000';
    expect(bytesToHex(b.bsonEncode({ hello: 'world' }))).toBe(hello);
    expect(b.bsonDecode(hexToBytes(hello))).toEqual({ hello: 'world' });
  });

  it('round-trips with extended types', async () => {
    const value = {
      ...SAMPLE,
      id: { $oid: '65538b40e4b0a1b2c3d4e5f6' },
      when: { $date: '2024-01-02T03:04:05.000Z' },
      blob: { $binary: 'AQID' },
    };
    const packed = await run('binary.json-to-bson', JSON.stringify(value));
    expect(JSON.parse(await run('binary.bson-to-json', packed))).toEqual(value);
    await expect(run('binary.json-to-bson', '[1]')).rejects.toThrow(/object/);
    expect(() => b.bsonDecode(hexToBytes('ff000000'))).toThrow(/BSON/);
  });
});

describe('Protobuf (schema-less)', () => {
  it('decodes varints, strings and nested messages', () => {
    expect(b.protobufDecode(hexToBytes('089601'))).toEqual([{ field: 1, wire: 'varint', varint: 150, zigzag: 75 }]);
    const [field] = b.protobufDecode(hexToBytes('120774657374696e67'));
    expect(field).toMatchObject({ field: 2, wire: 'len', string: 'testing' });
    const [outer] = b.protobufDecode(hexToBytes('1a03089601'));
    expect(outer.message).toEqual([{ field: 1, wire: 'varint', varint: 150, zigzag: 75 }]);
    expect(() => b.protobufDecode(hexToBytes('0b'))).toThrow(/wire type/);
  });
});

describe('PHP serialize', () => {
  it('round-trips arrays, maps, objects and Unicode', async () => {
    const serialized = 'a:3:{i:0;s:2:"é";s:1:"k";b:1;s:1:"o";O:3:"Foo":1:{s:3:"bar";d:1.5;}}';
    expect(b.phpUnserialize(serialized)).toEqual({ 0: 'é', k: true, o: { __class: 'Foo', bar: 1.5 } });
    expect(b.phpUnserialize('a:2:{i:0;i:1;i:1;N;}')).toEqual([1, null]);
    expect(await run('binary.php-serialize', '{"a":[1,"x"],"b":null}')).toBe(
      'a:2:{s:1:"a";a:2:{i:0;i:1;i:1;s:1:"x";}s:1:"b";N;}',
    );
    expect(b.phpUnserialize(b.phpSerialize({ o: { __class: 'Foo', bar: 'é' } }))).toEqual({
      o: { __class: 'Foo', bar: 'é' },
    });
    expect(() => b.phpUnserialize('s:5:"abc";')).toThrow();
  });
});

describe('Property lists', () => {
  const expected = { name: 'Speculo', count: 42, ok: true, list: ['a', 1.5] };

  it('converts XML plists', async () => {
    const xml =
      '<?xml version="1.0"?><plist version="1.0"><dict><key>name</key><string>Speculo</string><key>count</key><integer>42</integer><key>ok</key><true/><key>list</key><array><string>a</string><real>1.5</real></array></dict></plist>';
    expect(JSON.parse(await run('binary.plist-to-json', xml))).toEqual(expected);
  });

  it('converts binary plists produced by plutil', async () => {
    const hex =
      '62706c6973743030d4010203040506070855636f756e74546e616d65526f6b546c697374102a5753706563756c6f09a2090a5161233ff80000000000000811171c1f24262e2f32340000000000000101000000000000000b0000000000000000000000000000003d';
    expect(JSON.parse(await run('binary.plist-to-json', hex))).toEqual(expected);
  });
});
