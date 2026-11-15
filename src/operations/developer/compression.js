import { concatBytes, hexToBytes, toBytes } from '../bytes.js';
import { operationFactory } from '../define.js';
import { base64Decode, base64Encode, hexEncode } from '../encoding/codecs.js';
import { assertExpansionWithin } from '../limits.js';

export const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_EXPANSION_RATIO = 1000;

function ensureStreams() {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
    throw new Error('Compression streams are not supported in this browser.');
  }
}

async function readAll(
  stream,
  { inputSize, limit = MAX_DECOMPRESSED_BYTES, ratio = MAX_EXPANSION_RATIO, signal } = {},
) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('Operation cancelled.');
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (inputSize !== undefined) assertExpansionWithin(total, inputSize, { maxBytes: limit, maxRatio: ratio });
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return concatBytes(...chunks);
}

export async function compress(input, format = 'gzip') {
  ensureStreams();
  const bytes = toBytes(input);
  return readAll(new Blob([bytes]).stream().pipeThrough(new CompressionStream(format)));
}

/** Decompress with output-size and expansion-ratio limits (zip-bomb protection). */
export async function decompress(input, format = 'gzip', { limit, ratio, signal } = {}) {
  ensureStreams();
  const bytes = toBytes(input);
  try {
    return await readAll(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)), {
      inputSize: bytes.length,
      limit,
      ratio,
      signal,
    });
  } catch (error) {
    if (/limit|expanded|cancel/i.test(error.message)) throw error;
    throw new Error(`Could not decompress ${format} data: the input is corrupt or uses another format.`, {
      cause: error,
    });
  }
}

function decodeEncoded(text, encoding) {
  const value = String(text).trim();
  if (encoding === 'hex' || (encoding === 'auto' && /^(?:[0-9a-f]{2}\s?)+$/i.test(value))) return hexToBytes(value);
  return base64Decode(value);
}

const FORMAT_OPTION = {
  key: 'format',
  label: 'Format',
  type: 'select',
  default: 'gzip',
  choices: [
    { value: 'gzip', label: 'gzip' },
    { value: 'deflate', label: 'zlib (deflate)' },
    { value: 'deflate-raw', label: 'raw deflate' },
  ],
};
const op = operationFactory('Compression', { expensive: true, timeoutMs: 30_000 });

export const compressionOperations = [
  op({
    id: 'compress.gzip',
    name: 'Compress (gzip/deflate)',
    description: 'Compress text or bytes; output as Base64 or hex so it can live in a document.',
    aliases: ['gzip', 'zlib', 'deflate', 'zip'],
    inputType: 'bytes',
    inverse: 'decompress.gzip',
    options: [
      FORMAT_OPTION,
      {
        key: 'output',
        label: 'Output',
        type: 'select',
        default: 'base64',
        choices: [
          { value: 'base64', label: 'Base64' },
          { value: 'hex', label: 'Hex' },
        ],
      },
    ],
    run: async (bytes, { format, output }) => {
      const compressed = await compress(bytes, format);
      return output === 'hex' ? hexEncode(compressed) : base64Encode(compressed);
    },
  }),
  op({
    id: 'decompress.gzip',
    name: 'Decompress (gunzip/inflate)',
    description: `Decompress Base64 or hex gzip/deflate data (limited to ${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MB and ${MAX_EXPANSION_RATIO}× expansion).`,
    aliases: ['gunzip', 'inflate', 'unzip', 'zlib'],
    outputType: 'bytes',
    inverse: 'compress.gzip',
    options: [
      FORMAT_OPTION,
      {
        key: 'encoding',
        label: 'Input encoding',
        type: 'select',
        default: 'auto',
        choices: [
          { value: 'auto', label: 'Auto' },
          { value: 'base64', label: 'Base64' },
          { value: 'hex', label: 'Hex' },
        ],
      },
    ],
    run: (text, { format, encoding }, context) =>
      decompress(decodeEncoded(text, encoding), format, { signal: context?.signal }),
  }),
];
