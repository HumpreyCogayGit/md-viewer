// Independent encoders/decoders for binary serialization formats, operating on Uint8Array.
import { XMLParser } from 'fast-xml-parser';
import { bytesToHex, concatBytes, utf8Decode, utf8Encode } from '../bytes.js';
import { parseJson } from '../formats/json.js';
import { operationFactory } from '../define.js';
import { base64Decode, base64Encode, hexEncode } from '../encoding/codecs.js';
import { hexToBytes } from '../bytes.js';

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }
  need(count) {
    if (this.offset + count > this.bytes.length) throw new Error('Unexpected end of data.');
  }
  u8() {
    this.need(1);
    return this.bytes[this.offset++];
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.view.getBigUint64(this.offset);
    this.offset += 8;
    return v;
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.offset);
    this.offset += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.offset);
    this.offset += 4;
    return v;
  }
  i64() {
    this.need(8);
    const v = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.offset);
    this.offset += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.offset);
    this.offset += 8;
    return v;
  }
  take(count) {
    this.need(count);
    const v = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return v;
  }
  get done() {
    return this.offset >= this.bytes.length;
  }
}

const toSafeNumber = (big) =>
  big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(big) : big.toString();
const binaryToJson = (bytes) => ({ $binary: base64Encode(bytes) });
const MAX_DEPTH = 256;

class Writer {
  constructor() {
    this.chunks = [];
  }
  bytes(data) {
    this.chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }
  u8(...values) {
    this.bytes(values);
  }
  num(setter, size, value) {
    const buffer = new Uint8Array(size);
    new DataView(buffer.buffer)[setter](0, value);
    this.bytes(buffer);
  }
  result() {
    return concatBytes(...this.chunks);
  }
}

// ---------------------------------------------------------------- MessagePack
export function msgpackDecode(bytes) {
  const reader = new Reader(bytes);
  const read = (depth) => {
    if (depth > MAX_DEPTH) throw new Error('Nesting is too deep.');
    const type = reader.u8();
    if (type <= 0x7f) return type;
    if (type >= 0xe0) return type - 0x100;
    if ((type & 0xf0) === 0x80) return readMap(type & 0x0f, depth);
    if ((type & 0xf0) === 0x90) return readArray(type & 0x0f, depth);
    if ((type & 0xe0) === 0xa0) return utf8Decode(reader.take(type & 0x1f));
    switch (type) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return binaryToJson(reader.take(reader.u8()));
      case 0xc5:
        return binaryToJson(reader.take(reader.u16()));
      case 0xc6:
        return binaryToJson(reader.take(reader.u32()));
      case 0xca:
        return reader.f32();
      case 0xcb:
        return reader.f64();
      case 0xcc:
        return reader.u8();
      case 0xcd:
        return reader.u16();
      case 0xce:
        return reader.u32();
      case 0xcf:
        return toSafeNumber(reader.u64());
      case 0xd0:
        return reader.i8();
      case 0xd1:
        return reader.i16();
      case 0xd2:
        return reader.i32();
      case 0xd3:
        return toSafeNumber(reader.i64());
      case 0xd9:
        return utf8Decode(reader.take(reader.u8()));
      case 0xda:
        return utf8Decode(reader.take(reader.u16()));
      case 0xdb:
        return utf8Decode(reader.take(reader.u32()));
      case 0xdc:
        return readArray(reader.u16(), depth);
      case 0xdd:
        return readArray(reader.u32(), depth);
      case 0xde:
        return readMap(reader.u16(), depth);
      case 0xdf:
        return readMap(reader.u32(), depth);
      case 0xd4:
      case 0xd5:
      case 0xd6:
      case 0xd7:
      case 0xd8: {
        const size = { 0xd4: 1, 0xd5: 2, 0xd6: 4, 0xd7: 8, 0xd8: 16 }[type];
        const extType = reader.i8();
        const data = reader.take(size);
        if (extType === -1 && size === 4)
          return { $timestamp: new Date(new DataView(data.buffer, data.byteOffset).getUint32(0) * 1000).toISOString() };
        return { $ext: extType, data: base64Encode(data) };
      }
      case 0xc7:
      case 0xc8:
      case 0xc9: {
        const size = type === 0xc7 ? reader.u8() : type === 0xc8 ? reader.u16() : reader.u32();
        return { $ext: reader.i8(), data: base64Encode(reader.take(size)) };
      }
      default:
        throw new Error(`Invalid MessagePack type byte 0x${type.toString(16)}.`);
    }
  };
  const readArray = (length, depth) => Array.from({ length }, () => read(depth + 1));
  const readMap = (length, depth) => {
    const out = {};
    for (let i = 0; i < length; i += 1) {
      const key = read(depth + 1);
      out[typeof key === 'string' ? key : JSON.stringify(key)] = read(depth + 1);
    }
    return out;
  };
  const value = read(0);
  if (!reader.done) throw new Error(`${bytes.length - reader.offset} unexpected trailing bytes.`);
  return value;
}

export function msgpackEncode(value) {
  const w = new Writer();
  const write = (v) => {
    if (v === null || v === undefined) return w.u8(0xc0);
    if (v === false) return w.u8(0xc2);
    if (v === true) return w.u8(0xc3);
    if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        if (v >= 0 && v <= 0x7f) return w.u8(v);
        if (v < 0 && v >= -32) return w.u8(v + 0x100);
        if (v >= 0 && v <= 0xff) return w.u8(0xcc, v);
        if (v >= 0 && v <= 0xffff) {
          w.u8(0xcd);
          return w.num('setUint16', 2, v);
        }
        if (v >= 0 && v <= 0xffffffff) {
          w.u8(0xce);
          return w.num('setUint32', 4, v);
        }
        if (v >= -128 && v < 0) {
          w.u8(0xd0);
          return w.num('setInt8', 1, v);
        }
        if (v >= -32768 && v < 0) {
          w.u8(0xd1);
          return w.num('setInt16', 2, v);
        }
        if (v >= -2147483648 && v < 0) {
          w.u8(0xd2);
          return w.num('setInt32', 4, v);
        }
        w.u8(v < 0 ? 0xd3 : 0xcf);
        return w.num(v < 0 ? 'setBigInt64' : 'setBigUint64', 8, BigInt(v));
      }
      w.u8(0xcb);
      return w.num('setFloat64', 8, v);
    }
    if (typeof v === 'string') {
      const bytes = utf8Encode(v);
      if (bytes.length < 32) w.u8(0xa0 | bytes.length);
      else if (bytes.length <= 0xff) w.u8(0xd9, bytes.length);
      else if (bytes.length <= 0xffff) {
        w.u8(0xda);
        w.num('setUint16', 2, bytes.length);
      } else {
        w.u8(0xdb);
        w.num('setUint32', 4, bytes.length);
      }
      return w.bytes(bytes);
    }
    if (Array.isArray(v)) {
      if (v.length < 16) w.u8(0x90 | v.length);
      else if (v.length <= 0xffff) {
        w.u8(0xdc);
        w.num('setUint16', 2, v.length);
      } else {
        w.u8(0xdd);
        w.num('setUint32', 4, v.length);
      }
      return v.forEach(write);
    }
    if (typeof v === 'object') {
      if (typeof v.$binary === 'string' && Object.keys(v).length === 1) {
        const data = base64Decode(v.$binary);
        if (data.length <= 0xff) w.u8(0xc4, data.length);
        else {
          w.u8(0xc6);
          w.num('setUint32', 4, data.length);
        }
        return w.bytes(data);
      }
      const entries = Object.entries(v);
      if (entries.length < 16) w.u8(0x80 | entries.length);
      else if (entries.length <= 0xffff) {
        w.u8(0xde);
        w.num('setUint16', 2, entries.length);
      } else {
        w.u8(0xdf);
        w.num('setUint32', 4, entries.length);
      }
      return entries.forEach(([key, child]) => {
        write(key);
        write(child);
      });
    }
    throw new Error(`Cannot encode ${typeof v} as MessagePack.`);
  };
  write(value);
  return w.result();
}

// ---------------------------------------------------------------- CBOR (RFC 8949)
export function cborDecode(bytes) {
  const reader = new Reader(bytes);
  const readLength = (info) => {
    if (info < 24) return info;
    if (info === 24) return reader.u8();
    if (info === 25) return reader.u16();
    if (info === 26) return reader.u32();
    if (info === 27) return toSafeNumber(reader.u64());
    if (info === 31) return -1;
    throw new Error('Invalid CBOR length.');
  };
  const halfFloat = (bits) => {
    const exp = (bits >> 10) & 0x1f;
    const mant = bits & 0x3ff;
    const sign = bits & 0x8000 ? -1 : 1;
    if (exp === 0) return sign * mant * 2 ** -24;
    if (exp === 31) return mant ? NaN : sign * Infinity;
    return sign * (1 + mant / 1024) * 2 ** (exp - 15);
  };
  const read = (depth) => {
    if (depth > MAX_DEPTH) throw new Error('Nesting is too deep.');
    const initial = reader.u8();
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return null;
      if (info === 25) return halfFloat(reader.u16());
      if (info === 26) return reader.f32();
      if (info === 27) return reader.f64();
      if (info === 31) return Symbol.for('break');
      return { $simple: info < 24 ? info : reader.u8() };
    }
    const length = readLength(info);
    switch (major) {
      case 0:
        return length;
      case 1:
        return typeof length === 'string' ? `-${BigInt(length) + 1n}` : -1 - length;
      case 2:
      case 3: {
        let data;
        if (length === -1) {
          const parts = [];
          for (;;) {
            const part = read(depth + 1);
            if (part === Symbol.for('break')) break;
            parts.push(major === 2 ? base64Decode(part.$binary) : utf8Encode(part));
          }
          data = concatBytes(...parts);
        } else data = reader.take(length);
        return major === 2 ? binaryToJson(data) : utf8Decode(data);
      }
      case 4: {
        const out = [];
        for (let i = 0; length === -1 || i < length; i += 1) {
          const item = read(depth + 1);
          if (item === Symbol.for('break')) break;
          out.push(item);
        }
        return out;
      }
      case 5: {
        const out = {};
        for (let i = 0; length === -1 || i < length; i += 1) {
          const key = read(depth + 1);
          if (key === Symbol.for('break')) break;
          out[typeof key === 'string' ? key : JSON.stringify(key)] = read(depth + 1);
        }
        return out;
      }
      case 6: {
        const content = read(depth + 1);
        if (length === 0 || length === 1)
          return { $date: length === 1 ? new Date(content * 1000).toISOString() : content };
        if ((length === 2 || length === 3) && content?.$binary) {
          const big = BigInt(`0x${bytesToHex(base64Decode(content.$binary)) || '0'}`);
          return (length === 2 ? big : -1n - big).toString();
        }
        return { $tag: length, value: content };
      }
      default:
        throw new Error('Invalid CBOR major type.');
    }
  };
  const value = read(0);
  if (!reader.done) throw new Error(`${bytes.length - reader.offset} unexpected trailing bytes.`);
  return value;
}

export function cborEncode(value) {
  const w = new Writer();
  const head = (major, length) => {
    if (length < 24) return w.u8((major << 5) | length);
    if (length <= 0xff) return w.u8((major << 5) | 24, length);
    if (length <= 0xffff) {
      w.u8((major << 5) | 25);
      return w.num('setUint16', 2, length);
    }
    if (length <= 0xffffffff) {
      w.u8((major << 5) | 26);
      return w.num('setUint32', 4, length);
    }
    w.u8((major << 5) | 27);
    return w.num('setBigUint64', 8, BigInt(length));
  };
  const write = (v) => {
    if (v === null || v === undefined) return w.u8(0xf6);
    if (v === false) return w.u8(0xf4);
    if (v === true) return w.u8(0xf5);
    if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return v >= 0 ? head(0, v) : head(1, -1 - v);
      w.u8(0xfb);
      return w.num('setFloat64', 8, v);
    }
    if (typeof v === 'string') {
      const bytes = utf8Encode(v);
      head(3, bytes.length);
      return w.bytes(bytes);
    }
    if (Array.isArray(v)) {
      head(4, v.length);
      return v.forEach(write);
    }
    if (typeof v === 'object') {
      if (typeof v.$binary === 'string' && Object.keys(v).length === 1) {
        const data = base64Decode(v.$binary);
        head(2, data.length);
        return w.bytes(data);
      }
      const entries = Object.entries(v);
      head(5, entries.length);
      return entries.forEach(([key, child]) => {
        write(key);
        write(child);
      });
    }
    throw new Error(`Cannot encode ${typeof v} as CBOR.`);
  };
  write(value);
  return w.result();
}

// ---------------------------------------------------------------- BSON
export function bsonDecode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cstring = (offset) => {
    let end = offset;
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    if (end >= bytes.length) throw new Error('Unterminated BSON string.');
    return [utf8Decode(bytes.subarray(offset, end)), end + 1];
  };
  const readDocument = (offset, isArray, depth) => {
    if (depth > MAX_DEPTH) throw new Error('Nesting is too deep.');
    if (offset + 5 > bytes.length) throw new Error('Truncated BSON document.');
    const size = view.getInt32(offset, true);
    const end = offset + size;
    if (size < 5 || end > bytes.length || bytes[end - 1] !== 0) throw new Error('Invalid BSON document length.');
    const out = isArray ? [] : {};
    let cursor = offset + 4;
    while (cursor < end - 1) {
      const type = bytes[cursor];
      const [name, next] = cstring(cursor + 1);
      cursor = next;
      let value;
      switch (type) {
        case 0x01:
          value = view.getFloat64(cursor, true);
          cursor += 8;
          break;
        case 0x02: {
          const length = view.getInt32(cursor, true);
          value = utf8Decode(bytes.subarray(cursor + 4, cursor + 4 + length - 1));
          cursor += 4 + length;
          break;
        }
        case 0x03:
        case 0x04: {
          const length = view.getInt32(cursor, true);
          value = readDocument(cursor, type === 0x04, depth + 1);
          cursor += length;
          break;
        }
        case 0x05: {
          const length = view.getInt32(cursor, true);
          value = binaryToJson(bytes.subarray(cursor + 5, cursor + 5 + length));
          cursor += 5 + length;
          break;
        }
        case 0x07:
          value = { $oid: bytesToHex(bytes.subarray(cursor, cursor + 12)) };
          cursor += 12;
          break;
        case 0x08:
          value = bytes[cursor] !== 0;
          cursor += 1;
          break;
        case 0x09:
          value = { $date: new Date(Number(view.getBigInt64(cursor, true))).toISOString() };
          cursor += 8;
          break;
        case 0x0a:
          value = null;
          break;
        case 0x0b: {
          const [pattern, a] = cstring(cursor);
          const [flags, b] = cstring(a);
          value = { $regex: pattern, $options: flags };
          cursor = b;
          break;
        }
        case 0x10:
          value = view.getInt32(cursor, true);
          cursor += 4;
          break;
        case 0x11:
          value = { $timestamp: view.getBigUint64(cursor, true).toString() };
          cursor += 8;
          break;
        case 0x12:
          value = toSafeNumber(view.getBigInt64(cursor, true));
          cursor += 8;
          break;
        case 0x13:
          value = { $numberDecimal: bytesToHex(bytes.subarray(cursor, cursor + 16)) };
          cursor += 16;
          break;
        case 0xff:
          value = { $minKey: 1 };
          break;
        case 0x7f:
          value = { $maxKey: 1 };
          break;
        default:
          throw new Error(`Unsupported BSON type 0x${type.toString(16)}.`);
      }
      if (isArray) out.push(value);
      else out[name] = value;
    }
    return out;
  };
  return readDocument(0, false, 0);
}

export function bsonEncode(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('BSON needs a JSON object at the top level.');
  const encodeDocument = (object, isArray) => {
    const w = new Writer();
    const entries = isArray ? object.map((item, index) => [String(index), item]) : Object.entries(object);
    for (const [key, v] of entries) {
      const name = utf8Encode(key);
      const field = (type) => {
        w.u8(type);
        w.bytes(name);
        w.u8(0);
      };
      if (v === null || v === undefined) field(0x0a);
      else if (typeof v === 'boolean') {
        field(0x08);
        w.u8(v ? 1 : 0);
      } else if (typeof v === 'number') {
        if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
          field(0x10);
          const b = new Uint8Array(4);
          new DataView(b.buffer).setInt32(0, v, true);
          w.bytes(b);
        } else if (Number.isInteger(v)) {
          field(0x12);
          const b = new Uint8Array(8);
          new DataView(b.buffer).setBigInt64(0, BigInt(v), true);
          w.bytes(b);
        } else {
          field(0x01);
          const b = new Uint8Array(8);
          new DataView(b.buffer).setFloat64(0, v, true);
          w.bytes(b);
        }
      } else if (typeof v === 'string') {
        field(0x02);
        const data = utf8Encode(v);
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, data.length + 1, true);
        w.bytes(b);
        w.bytes(data);
        w.u8(0);
      } else if (v.$oid && /^[0-9a-f]{24}$/i.test(v.$oid)) {
        field(0x07);
        w.bytes(hexToBytes(v.$oid));
      } else if (v.$date) {
        field(0x09);
        const b = new Uint8Array(8);
        new DataView(b.buffer).setBigInt64(0, BigInt(Date.parse(v.$date)), true);
        w.bytes(b);
      } else if (typeof v.$binary === 'string') {
        field(0x05);
        const data = base64Decode(v.$binary);
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, data.length, true);
        w.bytes(b);
        w.u8(0);
        w.bytes(data);
      } else {
        field(Array.isArray(v) ? 0x04 : 0x03);
        w.bytes(encodeDocument(v, Array.isArray(v)));
      }
    }
    const body = w.result();
    const out = new Uint8Array(body.length + 5);
    new DataView(out.buffer).setInt32(0, out.length, true);
    out.set(body, 4);
    return out;
  };
  return encodeDocument(value, false);
}

// ---------------------------------------------------------------- Protobuf (schema-less)
export function protobufDecode(bytes, depth = 0) {
  if (depth > 32) throw new Error('Nesting is too deep.');
  const reader = new Reader(bytes);
  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = reader.u8();
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
      if (shift > 63n) throw new Error('Varint is too long.');
    }
  };
  const fields = [];
  while (!reader.done) {
    const key = varint();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) throw new Error('Invalid field number 0.');
    let value;
    if (wire === 0) {
      const raw = varint();
      const signed = raw & 1n ? -((raw + 1n) >> 1n) : raw >> 1n;
      value = { varint: toSafeNumber(raw), zigzag: toSafeNumber(signed) };
    } else if (wire === 1) {
      const data = reader.take(8);
      const dv = new DataView(data.buffer, data.byteOffset, 8);
      value = { fixed64: toSafeNumber(dv.getBigUint64(0, true)), double: dv.getFloat64(0, true) };
    } else if (wire === 5) {
      const data = reader.take(4);
      const dv = new DataView(data.buffer, data.byteOffset, 4);
      value = { fixed32: dv.getUint32(0, true), float: dv.getFloat32(0, true) };
    } else if (wire === 2) {
      const data = reader.take(Number(varint()));
      let nested;
      try {
        nested = data.length ? protobufDecode(data, depth + 1) : null;
      } catch {
        nested = null;
      }
      let text;
      try {
        text = utf8Decode(data, { fatal: true });
        if (/[\x00-\x08\x0e-\x1f]/.test(text)) text = null;
      } catch {
        text = null;
      }
      value =
        text !== null && (!nested || /^[\x20-\x7e\s -￿]*$/.test(text))
          ? { string: text, ...(nested ? { message: nested } : {}) }
          : nested
            ? { message: nested }
            : { bytes: bytesToHex(data, ' ') };
    } else throw new Error(`Unsupported wire type ${wire} (groups are not supported).`);
    fields.push({ field, wire: ['varint', 'i64', 'len', 'sgroup', 'egroup', 'i32'][wire], ...value });
  }
  return fields;
}

// ---------------------------------------------------------------- PHP serialize
export function phpUnserialize(text) {
  const bytes = utf8Encode(String(text).trim());
  let offset = 0;
  const expect = (char) => {
    if (String.fromCharCode(bytes[offset]) !== char) throw new Error(`Expected "${char}" at byte ${offset}.`);
    offset += 1;
  };
  const until = (char) => {
    const start = offset;
    while (offset < bytes.length && String.fromCharCode(bytes[offset]) !== char) offset += 1;
    if (offset >= bytes.length) throw new Error('Unexpected end of serialized data.');
    const value = utf8Decode(bytes.subarray(start, offset));
    offset += 1;
    return value;
  };
  const read = (depth) => {
    if (depth > MAX_DEPTH) throw new Error('Nesting is too deep.');
    const type = String.fromCharCode(bytes[offset]);
    offset += 1;
    if (type === 'N') {
      expect(';');
      return null;
    }
    expect(':');
    switch (type) {
      case 'b':
        return until(';') === '1';
      case 'i':
        return Number(until(';'));
      case 'd': {
        const v = until(';');
        return v === 'INF' ? 'Infinity' : v === '-INF' ? '-Infinity' : v === 'NAN' ? 'NaN' : Number(v);
      }
      case 's': {
        const length = Number(until(':'));
        expect('"');
        const value = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        expect('"');
        expect(';');
        return value;
      }
      case 'a': {
        const count = Number(until(':'));
        expect('{');
        const entries = [];
        for (let i = 0; i < count; i += 1) entries.push([read(depth + 1), read(depth + 1)]);
        expect('}');
        const isList = entries.every(([key], index) => key === index);
        return isList ? entries.map(([, v]) => v) : Object.fromEntries(entries);
      }
      case 'O': {
        until(':');
        expect('"');
        const className = until('"');
        expect(':');
        const count = Number(until(':'));
        expect('{');
        const object = { __class: className };
        for (let i = 0; i < count; i += 1) {
          const key = String(read(depth + 1)).replace(/^\0[^\0]*\0/, '');
          object[key] = read(depth + 1);
        }
        expect('}');
        return object;
      }
      default:
        throw new Error(`Unsupported PHP serialize type "${type}".`);
    }
  };
  const value = read(0);
  if (offset !== bytes.length) throw new Error('Unexpected trailing data.');
  return value;
}

export function phpSerialize(value) {
  const write = (v) => {
    if (v === null || v === undefined) return 'N;';
    if (typeof v === 'boolean') return `b:${v ? 1 : 0};`;
    if (typeof v === 'number') return Number.isInteger(v) ? `i:${v};` : `d:${v};`;
    if (typeof v === 'string') return `s:${utf8Encode(v).length}:"${v}";`;
    const entries = Array.isArray(v)
      ? v.map((item, index) => [index, item])
      : Object.entries(v).filter(([key]) => key !== '__class');
    const body = entries
      .map(
        ([key, item]) =>
          `${typeof key === 'number' || /^(0|[1-9]\d*)$/.test(key) ? `i:${key};` : write(key)}${write(item)}`,
      )
      .join('');
    if (!Array.isArray(v) && v.__class) return `O:${v.__class.length}:"${v.__class}":${entries.length}:{${body}}`;
    return `a:${entries.length}:{${body}}`;
  };
  return write(value);
}

// ---------------------------------------------------------------- Apple property lists (XML; binary bplist00)
const plistParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
});

export function plistXmlToJson(text) {
  const tree = plistParser.parse(String(text));
  const plist = tree.find((node) => node.plist)?.plist;
  if (!plist) throw new Error('No <plist> root element found.');
  const textOf = (children) => (children || []).map((child) => child['#text'] ?? '').join('');
  const convert = (node) => {
    const [tag] = Object.keys(node).filter((key) => key !== ':@');
    const children = node[tag];
    switch (tag) {
      case 'dict': {
        const out = {};
        const items = children.filter((child) => !('#text' in child));
        for (let i = 0; i < items.length; i += 2) out[textOf(items[i].key)] = convert(items[i + 1]);
        return out;
      }
      case 'array':
        return children.filter((child) => !('#text' in child)).map(convert);
      case 'string':
        return textOf(children);
      case 'integer':
        return Number(textOf(children));
      case 'real':
        return Number(textOf(children));
      case 'true':
        return true;
      case 'false':
        return false;
      case 'date':
        return { $date: textOf(children).trim() };
      case 'data':
        return { $binary: textOf(children).replace(/\s+/g, '') };
      default:
        throw new Error(`Unsupported plist element <${tag}>.`);
    }
  };
  const root = plist.find((child) => !('#text' in child));
  return root ? convert(root) : null;
}

export function bplistToJson(bytes) {
  if (utf8Decode(bytes.subarray(0, 8)) !== 'bplist00') throw new Error('Not a binary plist (bplist00).');
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 32, 32);
  const offsetSize = trailer.getUint8(6);
  const refSize = trailer.getUint8(7);
  const numObjects = Number(trailer.getBigUint64(8));
  const topObject = Number(trailer.getBigUint64(16));
  const tableOffset = Number(trailer.getBigUint64(24));
  const readUint = (offset, size) => {
    let value = 0;
    for (let i = 0; i < size; i += 1) value = value * 256 + bytes[offset + i];
    return value;
  };
  const offsets = Array.from({ length: numObjects }, (_, i) => readUint(tableOffset + i * offsetSize, offsetSize));
  const parse = (ref, depth) => {
    if (depth > MAX_DEPTH) throw new Error('Nesting is too deep.');
    const offset = offsets[ref];
    const marker = bytes[offset];
    const type = marker >> 4;
    let info = marker & 0x0f;
    let start = offset + 1;
    if (type !== 0 && type !== 1 && type !== 2 && type !== 3 && info === 0x0f) {
      const intMarker = bytes[start];
      const size = 1 << (intMarker & 0x0f);
      info = readUint(start + 1, size);
      start += 1 + size;
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    switch (type) {
      case 0x0:
        return marker === 0x09 ? true : marker === 0x08 ? false : null;
      case 0x1: {
        const size = 1 << info;
        return size === 8 ? toSafeNumber(dv.getBigInt64(start)) : readUint(start, size);
      }
      case 0x2:
        return info === 2 ? dv.getFloat32(start) : dv.getFloat64(start);
      case 0x3:
        return { $date: new Date((dv.getFloat64(start) + 978307200) * 1000).toISOString() };
      case 0x4:
        return binaryToJson(bytes.subarray(start, start + info));
      case 0x5:
        return String.fromCharCode(...bytes.subarray(start, start + info));
      case 0x6: {
        let s = '';
        for (let i = 0; i < info; i += 1) s += String.fromCharCode(dv.getUint16(start + i * 2));
        return s;
      }
      case 0x8:
        return { $uid: readUint(start, info + 1) };
      case 0xa:
        return Array.from({ length: info }, (_, i) => parse(readUint(start + i * refSize, refSize), depth + 1));
      case 0xd: {
        const out = {};
        for (let i = 0; i < info; i += 1)
          out[String(parse(readUint(start + i * refSize, refSize), depth + 1))] = parse(
            readUint(start + (info + i) * refSize, refSize),
            depth + 1,
          );
        return out;
      }
      default:
        throw new Error(`Unsupported bplist object type 0x${type.toString(16)}.`);
    }
  };
  return parse(topObject, 0);
}

// ---------------------------------------------------------------- Operations
function readBinaryInput(text, encoding) {
  const value = String(text).trim();
  if (encoding === 'hex' || (encoding === 'auto' && /^(?:0x)?(?:[0-9a-f]{2}[\s:]?)+$/i.test(value)))
    return hexToBytes(value);
  return base64Decode(value);
}
const writeBinaryOutput = (bytes, encoding) =>
  encoding === 'hex' ? hexEncode(bytes, { separator: ' ' }) : base64Encode(bytes);
const IN_OPTION = {
  key: 'encoding',
  label: 'Input encoding',
  type: 'select',
  default: 'auto',
  choices: [
    { value: 'auto', label: 'Auto (hex or Base64)' },
    { value: 'hex', label: 'Hex' },
    { value: 'base64', label: 'Base64' },
  ],
};
const OUT_OPTION = {
  key: 'encoding',
  label: 'Output encoding',
  type: 'select',
  default: 'base64',
  choices: [
    { value: 'base64', label: 'Base64' },
    { value: 'hex', label: 'Hex' },
  ],
};
const json = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
const op = operationFactory('Binary Formats', { outputLanguage: 'json' });

export const binaryFormatOperations = [
  op({
    id: 'binary.msgpack-to-json',
    name: 'MessagePack → JSON',
    description: 'Decode MessagePack given as hex or Base64.',
    aliases: ['msgpack'],
    inverse: 'binary.json-to-msgpack',
    options: [IN_OPTION],
    run: (text, { encoding }) => json(msgpackDecode(readBinaryInput(text, encoding))),
  }),
  op({
    id: 'binary.json-to-msgpack',
    name: 'JSON → MessagePack',
    description: 'Encode JSON as MessagePack (hex or Base64).',
    aliases: ['msgpack'],
    inverse: 'binary.msgpack-to-json',
    options: [OUT_OPTION],
    run: (text, { encoding }) => writeBinaryOutput(msgpackEncode(parseJson(text)), encoding),
  }),
  op({
    id: 'binary.cbor-to-json',
    name: 'CBOR → JSON',
    description: 'Decode CBOR (RFC 8949) given as hex or Base64.',
    aliases: ['cbor'],
    inverse: 'binary.json-to-cbor',
    options: [IN_OPTION],
    run: (text, { encoding }) => json(cborDecode(readBinaryInput(text, encoding))),
  }),
  op({
    id: 'binary.json-to-cbor',
    name: 'JSON → CBOR',
    description: 'Encode JSON as CBOR (hex or Base64).',
    aliases: ['cbor'],
    inverse: 'binary.cbor-to-json',
    options: [OUT_OPTION],
    run: (text, { encoding }) => writeBinaryOutput(cborEncode(parseJson(text)), encoding),
  }),
  op({
    id: 'binary.bson-to-json',
    name: 'BSON → JSON',
    description: 'Decode BSON documents to MongoDB Extended JSON.',
    aliases: ['bson', 'mongodb'],
    inverse: 'binary.json-to-bson',
    options: [IN_OPTION],
    run: (text, { encoding }) => json(bsonDecode(readBinaryInput(text, encoding))),
  }),
  op({
    id: 'binary.json-to-bson',
    name: 'JSON → BSON',
    description: 'Encode a JSON object as BSON ($oid/$date/$binary supported).',
    aliases: ['bson', 'mongodb'],
    inverse: 'binary.bson-to-json',
    options: [OUT_OPTION],
    run: (text, { encoding }) => writeBinaryOutput(bsonEncode(parseJson(text)), encoding),
  }),
  op({
    id: 'binary.protobuf-decode',
    name: 'Protobuf Decode (no schema)',
    description: 'Show field numbers, wire types and candidate values of a protobuf message.',
    aliases: ['protobuf', 'protocol buffers', 'grpc'],
    outputMode: 'report',
    notes: 'Without a schema, each field shows every plausible interpretation.',
    options: [IN_OPTION],
    run: (text, { encoding }) => json(protobufDecode(readBinaryInput(text, encoding))),
  }),
  op({
    id: 'binary.php-unserialize',
    name: 'PHP Unserialize → JSON',
    description: 'Decode PHP serialize() output (objects become {"__class": …}). Never executes code.',
    aliases: ['php', 'serialize'],
    inverse: 'binary.php-serialize',
    run: (text) => json(phpUnserialize(text)),
  }),
  op({
    id: 'binary.php-serialize',
    name: 'JSON → PHP Serialize',
    description: 'Encode JSON in PHP serialize() format.',
    aliases: ['php', 'serialize'],
    outputLanguage: 'text',
    inverse: 'binary.php-unserialize',
    run: (text) => phpSerialize(parseJson(text)),
  }),
  op({
    id: 'binary.plist-to-json',
    name: 'Apple Property List → JSON',
    description: 'Convert XML plists, or binary bplist00 given as hex/Base64, to JSON.',
    aliases: ['plist', 'bplist', 'macos', 'ios'],
    options: [IN_OPTION],
    run: (text, { encoding }) =>
      /^\s*</.test(text) ? json(plistXmlToJson(text)) : json(bplistToJson(readBinaryInput(text, encoding))),
  }),
];
