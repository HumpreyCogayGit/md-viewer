import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  isValidUtf8,
  toBytes,
  toText,
  utf8Decode,
  utf8Encode,
  byteLength,
} from './bytes.js';

describe('bytes helpers', () => {
  it('round-trips Unicode text through UTF-8', () => {
    const text = 'héllo 🌍 漢字';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
    expect(byteLength('é')).toBe(2);
  });

  it('converts hex both ways, accepting separators', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(bytesToHex(new Uint8Array([1, 2]), ' ')).toBe('01 02');
    expect(Array.from(hexToBytes('0x00 0f:FF'))).toEqual([0, 15, 255]);
    expect(() => hexToBytes('abc')).toThrow(/Invalid hex/);
    expect(() => hexToBytes('zz')).toThrow(/Invalid hex/);
  });

  it('never corrupts binary data when converting to text', () => {
    expect(toText(new Uint8Array([0xff, 0xfe]))).toBe('ff fe');
    expect(toText(utf8Encode('ok'))).toBe('ok');
    expect(isValidUtf8(new Uint8Array([0xc3]))).toBe(false);
    expect(toText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(toText(null)).toBe('');
  });

  it('normalizes buffers and concatenates', () => {
    expect(Array.from(toBytes(new Uint8Array([1]).buffer))).toEqual([1]);
    expect(Array.from(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])))).toEqual([1, 2, 3]);
  });
});
