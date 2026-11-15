// Text <-> byte helpers. Operations whose inputType/outputType is `bytes` receive and return Uint8Array.
// Text is always encoded as UTF-8 unless an operation says otherwise.

const encoder = new TextEncoder();

export function isBytes(value) {
  return value instanceof Uint8Array;
}

export function utf8Encode(text) {
  return encoder.encode(String(text));
}

export function utf8Decode(bytes, { fatal = false } = {}) {
  return new TextDecoder('utf-8', { fatal }).decode(bytes);
}

export function isValidUtf8(bytes) {
  try {
    utf8Decode(bytes, { fatal: true });
    return true;
  } catch {
    return false;
  }
}

export function toBytes(value) {
  if (isBytes(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return utf8Encode(value ?? '');
}

export function bytesToHex(bytes, separator = '') {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(separator);
}

export function hexToBytes(hex) {
  const clean = String(hex)
    .replace(/0x/gi, '')
    .replace(/[\s:,-]/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error('Invalid hex: expected an even number of hexadecimal digits.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Convert an operation result to text for insertion into the editor.
 * Valid UTF-8 bytes are decoded; anything else is shown as hex so binary data is never silently corrupted.
 */
export function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (isBytes(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = toBytes(value);
    return isValidUtf8(bytes) ? utf8Decode(bytes) : bytesToHex(bytes, ' ');
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function byteLength(value) {
  return isBytes(value) ? value.length : utf8Encode(value ?? '').length;
}

export function concatBytes(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
