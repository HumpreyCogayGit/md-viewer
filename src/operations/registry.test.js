import { describe, expect, it } from 'vitest';
import {
  createOperationRegistry,
  defineOperation,
  normalizeOperation,
  resolveOptions,
  runOperation,
} from './registry.js';
import { OperationCancelledError, OperationTimeoutError, assertExpansionWithin, withDeadline } from './limits.js';

const base = {
  id: 'test.op',
  name: 'Test',
  description: 'Test operation',
  category: 'Test',
  inputType: 'text',
  outputType: 'text',
  run: (input) => input,
};

describe('normalizeOperation', () => {
  it('applies defaults to raw objects passed straight to the registry (regression)', async () => {
    const registry = createOperationRegistry([{ ...base }]);
    const operation = registry.get('test.op');
    expect(operation.supportsSelection).toBe(true);
    expect(operation.options).toEqual([]);
    expect(operation.outputMode).toBe('replace');
    expect(await registry.execute('test.op', 'x')).toBe('x');
  });

  it('marks operations without input as insert-mode generators', () => {
    const operation = normalizeOperation({ ...base, inputType: 'none' });
    expect(operation.isGenerator).toBe(true);
    expect(operation.outputMode).toBe('insert');
  });

  it('rejects invalid definitions', () => {
    expect(() => defineOperation({ ...base, run: undefined })).toThrow(/run/);
    expect(() => defineOperation({ ...base, outputMode: 'explode' })).toThrow(/outputMode/);
    expect(() => defineOperation({ ...base, options: [{ key: 'a', type: 'colour' }] })).toThrow(/unknown type/);
    expect(() => defineOperation({ ...base, options: [{ key: 'a', type: 'select' }] })).toThrow(/choices/);
    expect(() =>
      defineOperation({
        ...base,
        options: [
          { key: 'a', type: 'text' },
          { key: 'a', type: 'text' },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});

describe('options schema', () => {
  const operation = defineOperation({
    ...base,
    options: [
      { key: 'width', label: 'Width', type: 'number', default: 4, min: 1, max: 16 },
      { key: 'strict', label: 'Strict', type: 'boolean' },
      { key: 'mode', label: 'Mode', type: 'select', choices: ['a', { value: 'b', label: 'Bee' }] },
      { key: 'prefix', label: 'Prefix', type: 'text', default: '> ' },
    ],
  });

  it('fills defaults and coerces values', () => {
    expect(resolveOptions(operation)).toEqual({ width: 4, strict: false, mode: 'a', prefix: '> ' });
    expect(resolveOptions(operation, { width: '8', strict: 'true', mode: 'b', extra: 1 })).toEqual({
      width: 8,
      strict: true,
      mode: 'b',
      prefix: '> ',
    });
  });

  it('rejects out-of-range and unknown choices', () => {
    expect(() => resolveOptions(operation, { width: 99 })).toThrow(/at most 16/);
    expect(() => resolveOptions(operation, { width: 'abc' })).toThrow(/number/);
    expect(() => resolveOptions(operation, { mode: 'z' })).toThrow(/one of/);
  });
});

describe('runOperation', () => {
  it('supports async run functions', async () => {
    const operation = defineOperation({ ...base, run: async (input) => `${input}!` });
    expect(await runOperation(operation, 'hi')).toBe('hi!');
  });

  it('passes bytes to byte operations and encodes text as UTF-8', async () => {
    const operation = defineOperation({ ...base, inputType: 'bytes', run: (bytes) => Array.from(bytes).join(',') });
    expect(await runOperation(operation, 'é')).toBe('195,169');
  });

  it('uses diagnose for a precise invalid-input message', async () => {
    const operation = defineOperation({ ...base, validate: () => false, diagnose: () => 'bad at line 2' });
    await expect(runOperation(operation, 'x')).rejects.toThrow('bad at line 2');
  });

  it('enforces input size limits', async () => {
    const operation = defineOperation({ ...base, maxInputSize: 3 });
    await expect(runOperation(operation, 'abcd')).rejects.toThrow(/too large/);
  });

  it('times out slow operations and honours cancellation', async () => {
    const slow = defineOperation({
      ...base,
      timeoutMs: 20,
      run: () => new Promise((resolve) => setTimeout(resolve, 200)),
    });
    await expect(runOperation(slow, 'x')).rejects.toBeInstanceOf(OperationTimeoutError);
    const controller = new AbortController();
    const pending = runOperation(slow, 'x', {}, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

describe('registry search', () => {
  const registry = createOperationRegistry([
    defineOperation({ ...base, id: 'enc.b64', name: 'Base64 Encode', category: 'Encoding', aliases: ['b64'] }),
    defineOperation({ ...base, id: 'date.unix', name: 'Unix → ISO', category: 'Date', aliases: ['epoch'] }),
    defineOperation({ ...base, id: 'fmt.json', name: 'Beautify JSON', category: 'Format', aliases: ['prettify'] }),
  ]);

  it('finds by name, alias, and category', () => {
    expect(registry.search('b64').map((op) => op.id)).toEqual(['enc.b64']);
    expect(registry.search('epoch').map((op) => op.id)).toEqual(['date.unix']);
    expect(registry.search('prettify').map((op) => op.id)).toEqual(['fmt.json']);
    expect(registry.search('format').map((op) => op.id)).toEqual(['fmt.json']);
    expect(registry.search('').length).toBe(3);
    expect(registry.search('nothing-matches')).toEqual([]);
  });

  it('groups by category', () => {
    expect(registry.grouped().map((group) => group.category)).toEqual(['Encoding', 'Date', 'Format']);
    expect(registry.categories()).toEqual(['Encoding', 'Date', 'Format']);
  });
});

describe('limits', () => {
  it('passes values through withDeadline', async () => {
    expect(await withDeadline(Promise.resolve(1), 100)).toBe(1);
  });

  it('guards against expansion bombs', () => {
    expect(() => assertExpansionWithin(10_000, 1, { maxRatio: 100 })).toThrow(/expanded/);
    expect(() => assertExpansionWithin(100, 1, { maxBytes: 50 })).toThrow(/limit/);
    expect(() => assertExpansionWithin(100, 10)).not.toThrow();
  });
});
