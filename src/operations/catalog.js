// The complete operation catalog. Adding an operation = one module + tests + an entry here.
import { createOperationRegistry } from './registry.js';
import { createDataConversionOperations } from './dataConversionOperations.js';
import { formattingOperations, validationOperations } from './structuredData/formatting.js';
import { structuredDataOperations } from './structuredData/index.js';
import { binaryFormatOperations } from './structuredData/binary.js';
import { encodingOperations } from './encoding/index.js';
import { textOperations } from './text/index.js';
import { hashingOperations } from './hashing/index.js';
import { dateOperations } from './dates/index.js';
import { developerOperations } from './developer/index.js';
import { markdownOperations } from './markdown/index.js';

export const allOperations = [
  ...formattingOperations,
  ...createDataConversionOperations(),
  ...structuredDataOperations,
  ...markdownOperations,
  ...encodingOperations,
  ...textOperations,
  ...hashingOperations,
  ...dateOperations,
  ...developerOperations,
  ...binaryFormatOperations,
  ...validationOperations,
];

export const defaultRegistry = createOperationRegistry(allOperations);

/** Category order for menus and the palette. */
export const CATEGORY_ORDER = [
  'Format',
  'Structured Data',
  'Tables',
  'Markdown',
  'Encoding',
  'Escaping',
  'Text',
  'Lines',
  'Cleanup',
  'Analysis',
  'Extract',
  'Hashing',
  'Date & Time',
  'Tokens & IDs',
  'Network',
  'Security Writing',
  'Developer',
  'Compression',
  'Binary Formats',
  'Validate',
  'Generate',
];

export function orderedGroups(registry = defaultRegistry, operations = registry.list) {
  const groups = registry.grouped(operations);
  return groups.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}
