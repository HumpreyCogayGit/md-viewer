import { networkOperations } from './network.js';
import { tokenOperations } from './tokens.js';
import { inspectOperations } from './inspect.js';
import { x509Operations } from './x509.js';
import { compressionOperations } from './compression.js';
import { codeOperations } from './code.js';
import { generatorOperations } from './generators.js';

export const developerOperations = [
  ...networkOperations,
  ...tokenOperations,
  ...inspectOperations,
  ...x509Operations,
  ...compressionOperations,
  ...codeOperations,
  ...generatorOperations,
];
