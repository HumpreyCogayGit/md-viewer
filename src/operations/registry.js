import { isBytes, toBytes, toText, byteLength } from './bytes.js';
import { withDeadline } from './limits.js';

export const OPERATION_SCHEMA_VERSION = 1;

export const OUTPUT_MODES = Object.freeze(['replace', 'insert', 'report']);
export const OPTION_TYPES = Object.freeze(['boolean', 'number', 'select', 'text', 'textarea']);

/** Default input limit (characters / bytes). Operations may lower or raise it with `maxInputSize`. */
export const DEFAULT_MAX_INPUT_SIZE = 10 * 1024 * 1024;
export const DEFAULT_MAX_OUTPUT_SIZE = 50 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;

const REQUIRED_FIELDS = ['id', 'name', 'description', 'category', 'inputType', 'outputType', 'run'];

const DEFAULTS = Object.freeze({
  aliases: [],
  options: [],
  outputMode: 'replace',
  // 'selection' (default): runs on the selection or current block; 'document': always receives the whole document.
  inputScope: 'selection',
  supportsSelection: true,
  supportsFencedBlock: false,
  inputLanguages: [],
  outputLanguage: undefined,
  potentiallyLossy: false,
  lossyWarning: undefined,
  networkAccess: false,
  expensive: false,
  insecure: false,
  inverse: undefined,
  inputExtensions: [],
  outputExtension: undefined,
  notes: undefined,
  maxInputSize: DEFAULT_MAX_INPUT_SIZE,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});

function validateOption(operationId, option) {
  if (!option || typeof option !== 'object') throw new TypeError(`Operation "${operationId}" has an invalid option.`);
  if (!option.key) throw new TypeError(`Operation "${operationId}" has an option without a key.`);
  if (!OPTION_TYPES.includes(option.type)) {
    throw new TypeError(`Operation "${operationId}" option "${option.key}" has unknown type "${option.type}".`);
  }
  if (option.type === 'select' && (!Array.isArray(option.choices) || option.choices.length === 0)) {
    throw new TypeError(`Operation "${operationId}" select option "${option.key}" needs choices.`);
  }
}

function validateOperation(operation) {
  if (!operation || typeof operation !== 'object') {
    throw new TypeError('An operation must be an object.');
  }

  for (const field of REQUIRED_FIELDS) {
    if (operation[field] === undefined || operation[field] === '') {
      throw new TypeError(`Operation is missing required field: ${field}`);
    }
  }

  if (typeof operation.run !== 'function') {
    throw new TypeError(`Operation "${operation.id}" must provide a run function.`);
  }

  for (const hook of ['validate', 'diagnose', 'detect']) {
    if (operation[hook] !== undefined && typeof operation[hook] !== 'function') {
      throw new TypeError(`Operation "${operation.id}" ${hook} must be a function.`);
    }
  }

  if (operation.outputMode !== undefined && !OUTPUT_MODES.includes(operation.outputMode)) {
    throw new TypeError(`Operation "${operation.id}" has unknown outputMode "${operation.outputMode}".`);
  }

  const seen = new Set();
  for (const option of operation.options || []) {
    validateOption(operation.id, option);
    if (seen.has(option.key)) throw new TypeError(`Operation "${operation.id}" has duplicate option "${option.key}".`);
    seen.add(option.key);
  }
}

function normalizeOption(option) {
  const fallback = { boolean: false, number: 0, select: option.choices?.[0]?.value ?? option.choices?.[0], text: '' };
  return Object.freeze({
    label: option.key,
    default: fallback[option.type] ?? '',
    ...option,
    choices: option.choices
      ? Object.freeze(
          option.choices.map((choice) =>
            typeof choice === 'object' ? choice : { value: choice, label: String(choice) },
          ),
        )
      : undefined,
  });
}

/** Apply defaults to an operation definition. Safe to call more than once. */
export function normalizeOperation(definition) {
  validateOperation(definition);
  const operation = { ...DEFAULTS, ...definition };
  operation.options = Object.freeze((definition.options || []).map(normalizeOption));
  operation.aliases = Object.freeze([...(definition.aliases || [])]);
  operation.inputLanguages = Object.freeze([...(definition.inputLanguages || [])]);
  operation.inputExtensions = Object.freeze([...(definition.inputExtensions || [])]);
  // Generators take no input and insert at the cursor.
  if (operation.inputType === 'none' && definition.outputMode === undefined) operation.outputMode = 'insert';
  operation.isGenerator = operation.inputType === 'none';
  return Object.freeze(operation);
}

export function defineOperation(definition) {
  return normalizeOperation(definition);
}

function coerceOptionValue(option, value) {
  switch (option.type) {
    case 'boolean':
      if (typeof value === 'string') return value === 'true' || value === '1' || value === 'on';
      return Boolean(value);
    case 'number': {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) throw new Error(`${option.label} must be a number.`);
      if (option.min !== undefined && number < option.min)
        throw new Error(`${option.label} must be at least ${option.min}.`);
      if (option.max !== undefined && number > option.max)
        throw new Error(`${option.label} must be at most ${option.max}.`);
      return option.integer === false ? number : Math.trunc(number);
    }
    case 'select': {
      const allowed = option.choices.map((choice) => choice.value);
      if (!allowed.includes(value)) throw new Error(`${option.label} must be one of: ${allowed.join(', ')}.`);
      return value;
    }
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

/** Merge provided options with declared defaults and validate their types. Unknown keys are dropped. */
export function resolveOptions(operation, provided = {}) {
  const resolved = {};
  for (const option of operation.options || []) {
    const value = Object.prototype.hasOwnProperty.call(provided, option.key) ? provided[option.key] : option.default;
    resolved[option.key] = coerceOptionValue(option, value);
  }
  return resolved;
}

/** Normalize an operation result to { output, warnings }. Operations may return `{ output, warnings }`. */
export function unwrapResult(value) {
  if (value && typeof value === 'object' && !isBytes(value) && Object.prototype.hasOwnProperty.call(value, 'output')) {
    return { output: value.output, warnings: Array.from(value.warnings || []) };
  }
  return { output: value, warnings: [] };
}

function prepareInput(operation, input) {
  if (operation.inputType === 'none') return '';
  if (operation.inputType === 'bytes') return toBytes(input);
  return isBytes(input) ? toText(input) : String(input ?? '');
}

function assertWithinLimit(size, limit, label) {
  if (size > limit) {
    throw new Error(`${label} is too large (${size.toLocaleString()} > ${limit.toLocaleString()} bytes).`);
  }
}

/**
 * Run an operation (sync or async) with option resolution, validation, size limits, and a deadline.
 * Returns the raw result (string, Uint8Array, ...). Use `toText` to place it in the editor.
 */
export async function runOperation(operation, input, providedOptions = {}, { signal, timeoutMs } = {}) {
  const options = resolveOptions(operation, providedOptions);
  const prepared = prepareInput(operation, input);
  assertWithinLimit(byteLength(prepared), operation.maxInputSize, 'Input');

  if (operation.inputType !== 'none' && operation.validate && !(await operation.validate(prepared, options))) {
    let detail;
    try {
      detail = operation.diagnose?.(prepared, options);
    } catch {
      detail = undefined;
    }
    throw new Error(detail || operation.invalidInputMessage || `Invalid input for ${operation.name}.`);
  }

  const result = await withDeadline(
    Promise.resolve().then(() => operation.run(prepared, options, { signal })),
    timeoutMs ?? operation.timeoutMs,
    signal,
  );
  const { output } = unwrapResult(result);
  if (typeof output === 'string' || isBytes(output)) {
    assertWithinLimit(byteLength(output), DEFAULT_MAX_OUTPUT_SIZE, 'Output');
  }
  return result;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** Score how well an operation matches a query. 0 means no match. */
export function scoreOperation(operation, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  const name = normalizeSearchText(operation.name);
  const aliases = operation.aliases.map(normalizeSearchText);
  const haystack = [
    name,
    ...aliases,
    normalizeSearchText(operation.category),
    normalizeSearchText(operation.description),
    operation.id,
  ].join(' ');

  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return 0;
    if (name.startsWith(term)) score += 10;
    else if (name.includes(term)) score += 6;
    if (aliases.some((alias) => alias === term)) score += 8;
    else if (aliases.some((alias) => alias.includes(term))) score += 4;
    score += 1;
  }
  return score;
}

export function createOperationRegistry(operations = []) {
  const operationMap = new Map();

  for (const definition of operations) {
    const operation = normalizeOperation(definition);
    if (operationMap.has(operation.id)) {
      throw new Error(`Duplicate operation id: ${operation.id}`);
    }
    operationMap.set(operation.id, operation);
  }

  const list = Object.freeze(Array.from(operationMap.values()));

  return Object.freeze({
    list,
    has(operationId) {
      return operationMap.has(operationId);
    },
    get(operationId) {
      const operation = operationMap.get(operationId);
      if (!operation) throw new Error(`Unknown operation: ${operationId}`);
      return operation;
    },
    byCategory(category) {
      return list.filter((operation) => operation.category === category);
    },
    categories() {
      return Array.from(new Set(list.map((operation) => operation.category)));
    },
    grouped(operationsToGroup = list) {
      const groups = new Map();
      for (const operation of operationsToGroup) {
        if (!groups.has(operation.category)) groups.set(operation.category, []);
        groups.get(operation.category).push(operation);
      }
      return Array.from(groups, ([category, items]) => ({ category, operations: items }));
    },
    search(query) {
      return list
        .map((operation, index) => ({ operation, index, score: scoreOperation(operation, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((entry) => entry.operation);
    },
    execute(operationId, input, options = {}, context = {}) {
      return runOperation(this.get(operationId), input, options, context);
    },
  });
}
