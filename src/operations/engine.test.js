import { describe, expect, it, vi } from 'vitest';
import { defaultRegistry } from './catalog.js';
import { suggestOperations } from './suggestions.js';
import {
  createRecipe,
  createRecipeStore,
  migrateRecipe,
  moveStep,
  parseRecipe,
  recipeFromFragment,
  recipeToFragment,
  runRecipe,
  serializeRecipe,
  validateRecipe,
} from './recipes.js';
import { runInWorker, runSmart, shouldUseWorker, WORKER_THRESHOLD_BYTES } from './workerClient.js';
import { executeOperationDetailed } from './selection.js';
import { OperationCancelledError, OperationTimeoutError } from './limits.js';

const ids = (text) => suggestOperations(text, { registry: defaultRegistry }).map((s) => s.operationId);

describe('suggestions (magic)', () => {
  it('detects common formats and suggests matching operations', () => {
    expect(ids('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig')[0]).toBe('jwt.decode');
    expect(ids('SGVsbG8sIFNwZWN1bG8h')).toContain('decode.base64');
    expect(ids('48 65 6c 6c 6f')).toContain('decode.hex');
    expect(ids('a%20b%26c')).toContain('decode.url');
    expect(ids('{"a":1}')).toContain('format.json-beautify');
    expect(ids('1700000000')).toContain('date.unix-to-iso');
    expect(ids('c232ab00-9414-11ec-b3c8-9f6bdeced846')).toContain('uuid.inspect');
    expect(ids('*/5 * * * *')).toContain('cron.explain');
    expect(ids('a\tb\n1\t2')[0]).toBe('table.csv-to-markdown');
    expect(ids('SELECT * FROM t WHERE a = 1')).toContain('format.sql-beautify');
    expect(ids('“curly”')).toContain('cleanup.smart-to-ascii');
  });

  it('does not suggest for plain prose or empty input', () => {
    expect(ids('Just a normal sentence about writing.')).toEqual([]);
    expect(ids('')).toEqual([]);
  });

  it('only suggests; it never runs operations', () => {
    const execute = vi.fn();
    const registry = { has: () => true, execute };
    expect(suggestOperations('{"a":1}', { registry }).length).toBeGreaterThan(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('recipes', () => {
  const recipe = createRecipe({
    name: 'Clean and encode',
    steps: [
      { operationId: 'text.trim' },
      { operationId: 'case.upper', enabled: false },
      { operationId: 'encode.base64' },
      { operationId: 'decode.base64' },
      { operationId: 'encode.hex', options: { separator: ' ' } },
    ],
  });

  it('runs enabled steps in order and records intermediate output', async () => {
    const result = await runRecipe(recipe, '  hi  ', { registry: defaultRegistry });
    expect(result.output).toBe('68 69');
    expect(result.steps.map((s) => s.output)).toEqual(['hi', 'aGk=', 'hi', '68 69']);
  });

  it('passes bytes between steps without corrupting binary data', async () => {
    const binary = createRecipe({ steps: ['decode.base64', 'encode.hex'] });
    expect((await runRecipe(binary, '//79', { registry: defaultRegistry })).output).toBe('fffefd');
  });

  it('stops at the first failing step and reports it', async () => {
    const failing = createRecipe({ steps: ['decode.base64', 'case.upper'] });
    const result = await runRecipe(failing, '***', { registry: defaultRegistry });
    expect(result.error).toMatch(/Base64 Decode.*Invalid Base64/);
    expect(result.steps).toHaveLength(1);
  });

  it('supports per-line (fork) mode', async () => {
    const perLine = createRecipe({ steps: ['encode.base64'], perItem: 'line' });
    expect((await runRecipe(perLine, 'a\n\nb', { registry: defaultRegistry })).output).toBe('YQ==\n\nYg==');
  });

  it('serializes to versioned JSON and parses it back', () => {
    const json = serializeRecipe(recipe);
    expect(JSON.parse(json)).toMatchObject({ version: 1, name: 'Clean and encode' });
    const parsed = parseRecipe(json, defaultRegistry);
    expect(parsed.steps.map((s) => [s.operationId, s.enabled])).toEqual(
      recipe.steps.map((s) => [s.operationId, s.enabled]),
    );
    expect(() => parseRecipe('{"version":1,"steps":[{"operationId":"nope"}]}', defaultRegistry)).toThrow(
      /unknown operation/,
    );
    expect(() => parseRecipe('{"version":99,"steps":[]}', defaultRegistry)).toThrow(/newer version/);
    expect(() => parseRecipe('not json')).toThrow(/not valid JSON/);
  });

  it('migrates v0 recipes', () => {
    expect(migrateRecipe(['text.trim', 'case.upper']).steps.map((s) => s.operationId)).toEqual([
      'text.trim',
      'case.upper',
    ]);
    expect(migrateRecipe({ operations: [{ op: 'text.trim', args: {} }] }).steps[0].operationId).toBe('text.trim');
  });

  it('validates options and generator placement', () => {
    const bad = createRecipe({
      steps: [{ operationId: 'text.wrap', options: { width: 1 } }, { operationId: 'generate.uuid' }],
    });
    expect(validateRecipe(bad, defaultRegistry)).toEqual([
      'Step 1 (Wrap Text): Width must be at least 10.',
      'Step 2 (UUID) ignores its input; it should be the first step.',
    ]);
  });

  it('shares recipes in the URL fragment without any input', () => {
    const fragment = recipeToFragment(recipe);
    expect(fragment).toMatch(/^#recipe=[A-Za-z0-9_-]+$/);
    expect(fragment).not.toContain('hi');
    const restored = recipeFromFragment(fragment, defaultRegistry);
    expect(restored.steps.map((s) => s.operationId)).toEqual(recipe.steps.map((s) => s.operationId));
    expect(recipeFromFragment('#other=1')).toBeNull();
    expect(() => recipeFromFragment('#recipe=abcd')).toThrow(/damaged/);
  });

  it('reorders steps', () => {
    expect(
      moveStep(recipe, 0, 2)
        .steps.map((s) => s.operationId)
        .slice(0, 3),
    ).toEqual(['case.upper', 'encode.base64', 'text.trim']);
    expect(moveStep(recipe, 9, 0)).toBe(recipe);
  });

  it('persists recipes in storage and survives storage failures', () => {
    const memory = new Map();
    const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
    const store = createRecipeStore(storage);
    expect(store.save(recipe)).toBe(true);
    expect(store.list().map((r) => r.name)).toEqual(['Clean and encode']);
    store.remove(recipe.id);
    expect(store.list()).toEqual([]);
    const broken = createRecipeStore({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(broken.list()).toEqual([]);
    expect(broken.save(recipe)).toBe(false);
  });
});

describe('worker client', () => {
  class FakeWorker {
    constructor(behaviour) {
      this.behaviour = behaviour;
      this.terminated = false;
    }
    postMessage(message) {
      if (this.behaviour === 'hang') return;
      setTimeout(
        () =>
          this.onmessage({
            data:
              this.behaviour === 'fail'
                ? { id: message.id, ok: false, error: 'boom' }
                : { id: message.id, ok: true, output: `worked:${message.input}`, warnings: [] },
          }),
        1,
      );
    }
    terminate() {
      this.terminated = true;
    }
  }

  const operation = defaultRegistry.get('case.upper');

  it('resolves with the worker result and terminates the worker', async () => {
    const worker = new FakeWorker('ok');
    expect(await runInWorker(operation, 'x', {}, { workerFactory: () => worker })).toEqual({
      output: 'worked:x',
      warnings: [],
    });
    expect(worker.terminated).toBe(true);
  });

  it('propagates errors', async () => {
    await expect(runInWorker(operation, 'x', {}, { workerFactory: () => new FakeWorker('fail') })).rejects.toThrow(
      'boom',
    );
  });

  it('terminates hung workers on timeout and on cancel', async () => {
    const hung = new FakeWorker('hang');
    await expect(runInWorker(operation, 'x', {}, { workerFactory: () => hung, timeoutMs: 10 })).rejects.toBeInstanceOf(
      OperationTimeoutError,
    );
    expect(hung.terminated).toBe(true);
    const controller = new AbortController();
    const cancelled = new FakeWorker('hang');
    const pending = runInWorker(
      operation,
      'x',
      {},
      { workerFactory: () => cancelled, signal: controller.signal, timeoutMs: 1000 },
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError);
    expect(cancelled.terminated).toBe(true);
  });

  it('falls back to the main thread without Worker support', async () => {
    expect(await runInWorker(operation, 'x', {}, { workerFactory: () => null })).toEqual({ output: 'X', warnings: [] });
  });

  it('chooses the worker for expensive or large inputs', async () => {
    expect(shouldUseWorker(defaultRegistry.get('compress.gzip'), 'x')).toBe(true);
    expect(shouldUseWorker(operation, 'x')).toBe(false);
    expect(shouldUseWorker(operation, 'x'.repeat(WORKER_THRESHOLD_BYTES + 1))).toBe(true);
    expect(await runSmart(operation, 'x', {})).toEqual({ output: 'X', warnings: [] });
  });

  it('plugs into the selection adapter as a runner', async () => {
    const runner = vi.fn(async () => ({ output: 'from worker', warnings: ['w'] }));
    expect(await executeOperationDetailed(operation, 'x', {}, { runner })).toEqual({
      text: 'from worker',
      warnings: ['w'],
    });
  });
});
