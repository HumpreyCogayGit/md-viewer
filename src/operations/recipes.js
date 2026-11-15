// Recipes: ordered, configurable chains of operations. Recipes never contain user input.
import { runOperation, unwrapResult, resolveOptions, OPERATION_SCHEMA_VERSION } from './registry.js';
import { toText, isBytes } from './bytes.js';
import { base64Decode, base64Encode } from './encoding/codecs.js';
import { utf8Decode } from './bytes.js';

export const RECIPE_SCHEMA_VERSION = 1;
export const RECIPE_STORAGE_KEY = 'speculo.recipes.v1';

let stepCounter = 0;
const newStepId = () => `step-${Date.now().toString(36)}-${(stepCounter += 1)}`;

export function createStep(operationId, options = {}, enabled = true) {
  return { id: newStepId(), operationId, options: { ...options }, enabled };
}

export function createRecipe({ name = 'Untitled recipe', steps = [], perItem = 'none' } = {}) {
  return {
    version: RECIPE_SCHEMA_VERSION,
    id: `recipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    perItem,
    steps: steps.map((step) =>
      typeof step === 'string'
        ? createStep(step)
        : {
            ...createStep(step.operationId, step.options, step.enabled !== false),
            ...(step.id ? { id: step.id } : {}),
          },
    ),
  };
}

/** Upgrade older recipe shapes. v0 was a bare array of operation ids. */
export function migrateRecipe(data) {
  if (Array.isArray(data)) return createRecipe({ steps: data });
  if (!data || typeof data !== 'object') throw new Error('A recipe must be a JSON object.');
  const version = data.version ?? 0;
  if (version > RECIPE_SCHEMA_VERSION)
    throw new Error(`This recipe was made by a newer version of Speculo (v${version}).`);
  if (version === 0)
    return createRecipe({
      name: data.name,
      steps: (data.steps || data.operations || []).map((s) =>
        typeof s === 'string'
          ? s
          : { operationId: s.operationId || s.id || s.op, options: s.options || s.args, enabled: s.enabled },
      ),
    });
  return {
    ...createRecipe({ name: data.name, perItem: data.perItem, steps: data.steps }),
    id: data.id || createRecipe().id,
  };
}

/** Validate operations and options against a registry. Returns a list of problems (empty when valid). */
export function validateRecipe(recipe, registry) {
  const problems = [];
  recipe.steps.forEach((step, index) => {
    if (!registry.has(step.operationId)) {
      problems.push(`Step ${index + 1}: unknown operation "${step.operationId}".`);
      return;
    }
    const operation = registry.get(step.operationId);
    try {
      resolveOptions(operation, step.options);
    } catch (error) {
      problems.push(`Step ${index + 1} (${operation.name}): ${error.message}`);
    }
    if (operation.isGenerator && index > 0)
      problems.push(`Step ${index + 1} (${operation.name}) ignores its input; it should be the first step.`);
  });
  return problems;
}

export function serializeRecipe(recipe) {
  return JSON.stringify(
    {
      $schema: 'speculo-recipe',
      version: RECIPE_SCHEMA_VERSION,
      operationSchemaVersion: OPERATION_SCHEMA_VERSION,
      name: recipe.name,
      perItem: recipe.perItem || 'none',
      steps: recipe.steps.map(({ operationId, options, enabled }) => ({ operationId, options, enabled })),
    },
    null,
    2,
  );
}

export function parseRecipe(json, registry) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('The recipe file is not valid JSON.');
  }
  const recipe = migrateRecipe(data);
  if (registry) {
    const problems = validateRecipe(recipe, registry);
    if (problems.length) throw new Error(problems.join(' '));
  }
  return recipe;
}

/** Share link fragment containing only the recipe (never the input). */
export function recipeToFragment(recipe) {
  const compact = JSON.stringify({
    v: RECIPE_SCHEMA_VERSION,
    n: recipe.name,
    p: recipe.perItem || 'none',
    s: recipe.steps.map((s) => [s.operationId, s.options, s.enabled ? 1 : 0]),
  });
  return `#recipe=${base64Encode(compact, { urlSafe: true, pad: false })}`;
}

export function recipeFromFragment(hash, registry) {
  const match = /(?:^#|&)recipe=([A-Za-z0-9_-]+)/.exec(String(hash || ''));
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(utf8Decode(base64Decode(match[1], { urlSafe: true })));
  } catch {
    throw new Error('The shared recipe link is damaged.');
  }
  return parseRecipe(
    {
      version: data.v,
      name: data.n,
      perItem: data.p,
      steps: data.s.map(([operationId, options, enabled]) => ({ operationId, options, enabled: enabled !== 0 })),
    },
    registry,
  );
}

const splitItems = (text, mode) => {
  if (mode === 'line')
    return { items: String(text).split(/\r?\n/), join: (parts) => parts.join(/\r\n/.test(text) ? '\r\n' : '\n') };
  if (mode === 'paragraph') return { items: String(text).split(/\r?\n\s*\r?\n/), join: (parts) => parts.join('\n\n') };
  return { items: [text], join: (parts) => parts[0] };
};

async function runStep(operation, input, options, { perItem, signal }) {
  if (perItem === 'none' || operation.isGenerator || isBytes(input)) {
    const result = unwrapResult(await runOperation(operation, input, options, { signal }));
    return { output: result.output, warnings: result.warnings };
  }
  const { items, join } = splitItems(toText(input), perItem);
  const outputs = [];
  const warnings = [];
  for (const item of items) {
    if (!item.trim()) {
      outputs.push(item);
      continue;
    }
    const result = unwrapResult(await runOperation(operation, item, options, { signal }));
    outputs.push(toText(result.output));
    warnings.push(...result.warnings);
  }
  return { output: join(outputs), warnings };
}

/**
 * Run enabled steps in order. Each step's output (text or bytes) feeds the next step.
 * Resolves to { output, steps: [{ stepId, operationId, output, error, warnings, ms }] }; stops at the first error.
 */
export async function runRecipe(recipe, input, { registry, signal, onStep } = {}) {
  let current = input;
  const steps = [];
  for (const step of recipe.steps) {
    if (!step.enabled) continue;
    if (signal?.aborted) throw new Error('Operation cancelled.');
    const started = Date.now();
    const operation = registry.get(step.operationId);
    try {
      const { output, warnings } = await runStep(operation, current, step.options, {
        perItem: recipe.perItem || 'none',
        signal,
      });
      current = output;
      const record = {
        stepId: step.id,
        operationId: step.operationId,
        output: toText(output),
        warnings,
        ms: Date.now() - started,
      };
      steps.push(record);
      onStep?.(record);
    } catch (error) {
      const record = {
        stepId: step.id,
        operationId: step.operationId,
        error: error.message,
        warnings: [],
        ms: Date.now() - started,
      };
      steps.push(record);
      onStep?.(record);
      return { output: undefined, error: `Step "${operation.name}" failed: ${error.message}`, steps };
    }
  }
  return { output: toText(current), steps };
}

export function moveStep(recipe, from, to) {
  const steps = [...recipe.steps];
  if (from < 0 || from >= steps.length) return recipe;
  const target = Math.max(0, Math.min(steps.length - 1, to));
  const [step] = steps.splice(from, 1);
  steps.splice(target, 0, step);
  return { ...recipe, steps };
}

/** localStorage-backed recipe library. All storage access is guarded (private mode, quota). */
export function createRecipeStore(storage = globalThis.localStorage) {
  const read = () => {
    try {
      const raw = storage?.getItem(RECIPE_STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list)
        ? list.map((item) => migrateRecipe(item)).map((recipe, i) => ({ ...recipe, id: list[i].id || recipe.id }))
        : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      storage?.setItem(RECIPE_STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  };
  return {
    list: read,
    save(recipe) {
      const list = read().filter((item) => item.id !== recipe.id);
      list.push(recipe);
      return write(list);
    },
    remove(id) {
      return write(read().filter((item) => item.id !== id));
    },
  };
}
