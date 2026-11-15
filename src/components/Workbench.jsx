import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { byteLength } from '../operations/bytes.js';
import {
  createRecipe,
  createRecipeStore,
  createStep,
  moveStep,
  parseRecipe,
  recipeToFragment,
  runRecipe,
  serializeRecipe,
  validateRecipe,
} from '../operations/recipes.js';
import { downloadText, readFile } from '../export/files.js';
import { OperationOptionsForm, defaultOptionValues } from './OperationOptionsForm.jsx';
import { OperationPalette } from './OperationPalette.jsx';

const stats = (text = '') =>
  `${text.length.toLocaleString()} chars · ${(text ? text.split('\n').length : 0).toLocaleString()} lines · ${byteLength(text).toLocaleString()} B`;

/**
 * Scratch area: input → recipe → output. Never touches the document unless the user inserts the output.
 */
export function Workbench({
  registry,
  initialInput = '',
  initialRecipe,
  onClose,
  onInsert,
  onRequestSelection,
  notify,
}) {
  const store = useMemo(() => createRecipeStore(), []);
  const [input, setInput] = useState(initialInput);
  const [recipe, setRecipe] = useState(() => initialRecipe || createRecipe());
  const [autoRun, setAutoRun] = useState(true);
  const [result, setResult] = useState({ output: '', steps: [] });
  const [running, setRunning] = useState(false);
  const [picker, setPicker] = useState(false);
  const [saved, setSaved] = useState(() => store.list());
  const [dragIndex, setDragIndex] = useState(null);
  const abortRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (initialRecipe) setRecipe(initialRecipe);
  }, [initialRecipe]);
  useEffect(() => {
    setInput(initialInput);
  }, [initialInput]);

  const problems = useMemo(() => validateRecipe(recipe, registry), [recipe, registry]);
  const hasExpensive = recipe.steps.some(
    (step) => step.enabled && registry.has(step.operationId) && registry.get(step.operationId).expensive,
  );

  const execute = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      const outcome = await runRecipe(recipe, input, { registry, signal: controller.signal });
      if (!controller.signal.aborted) setResult(outcome);
    } catch (error) {
      if (!controller.signal.aborted) setResult({ output: '', steps: [], error: error.message });
    } finally {
      if (abortRef.current === controller) setRunning(false);
    }
  }, [recipe, input, registry]);

  // Auto-run on change (debounced). Expensive recipes need an explicit Run.
  useEffect(() => {
    if (!autoRun || hasExpensive || problems.length) return undefined;
    const timer = setTimeout(execute, 300);
    return () => clearTimeout(timer);
  }, [autoRun, hasExpensive, problems.length, execute]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateStep = (id, patch) =>
    setRecipe((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    }));
  const removeStep = (id) =>
    setRecipe((current) => ({ ...current, steps: current.steps.filter((step) => step.id !== id) }));
  const move = (from, to) => setRecipe((current) => moveStep(current, from, to));

  const addStep = (operationId, options) => {
    const operation = registry.get(operationId);
    setRecipe((current) => ({
      ...current,
      steps: [...current.steps, createStep(operationId, { ...defaultOptionValues(operation), ...options })],
    }));
    setPicker(false);
  };

  const saveRecipe = () => {
    const name = window.prompt('Recipe name', recipe.name);
    if (!name) return;
    const next = { ...recipe, name };
    setRecipe(next);
    const ok = store.save(next);
    notify(
      ok ? `Saved recipe “${name}”.` : 'Could not save: browser storage is unavailable.',
      ok ? 'success' : 'error',
    );
    setSaved(store.list());
  };

  const loadRecipe = (id) => {
    const found = saved.find((item) => item.id === id);
    if (found) setRecipe(found);
  };

  const deleteRecipe = () => {
    if (!saved.some((item) => item.id === recipe.id)) return;
    store.remove(recipe.id);
    setSaved(store.list());
    notify(`Deleted recipe “${recipe.name}”.`, 'info');
  };

  const importRecipe = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setRecipe(parseRecipe(await readFile(file), registry));
      notify('Recipe imported.');
    } catch (error) {
      notify(`Could not import recipe: ${error.message}`, 'error');
    }
  };

  const shareLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${recipeToFragment(recipe)}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('Share link copied. It contains the recipe only — never your input.');
    } catch {
      window.prompt('Copy this link (recipe only, no input):', url);
    }
  };

  const stepResults = new Map(result.steps.map((step) => [step.stepId, step]));

  return (
    <section className="workbench" aria-label="Workbench">
      <header className="panel-header">
        <h2>Workbench</h2>
        <span className="muted">Scratch area — the document is not changed until you insert the output.</span>
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label="Close workbench" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="workbench-grid">
        <div className="workbench-io">
          <div className="io-header">
            <label htmlFor="workbench-input">Input</label>
            <span className="muted">{stats(input)}</span>
            <button type="button" className="btn btn-small" onClick={() => setInput(onRequestSelection())}>
              Use selection
            </button>
          </div>
          <textarea
            id="workbench-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            placeholder="Paste or type input here…"
          />
        </div>

        <div className="workbench-recipe">
          <div className="io-header">
            <input
              aria-label="Recipe name"
              className="recipe-name"
              value={recipe.name}
              onChange={(event) => setRecipe({ ...recipe, name: event.target.value })}
            />
          </div>
          <div className="recipe-toolbar">
            <label className="option-checkbox">
              <input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} />
              <span>Auto-run{hasExpensive ? ' (off for expensive steps)' : ''}</span>
            </label>
            <label>
              <span className="sr-only">Apply to</span>
              <select
                aria-label="Apply each step to"
                value={recipe.perItem || 'none'}
                onChange={(event) => setRecipe({ ...recipe, perItem: event.target.value })}
              >
                <option value="none">Whole input</option>
                <option value="line">Each line</option>
                <option value="paragraph">Each paragraph</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={execute}
              disabled={running || problems.length > 0}
            >
              {running ? 'Running…' : 'Run'}
            </button>
            {running && (
              <button type="button" className="btn btn-small" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          {problems.length > 0 && (
            <ul className="warning-list">
              {problems.map((problem) => (
                <li key={problem}>⚠️ {problem}</li>
              ))}
            </ul>
          )}
          <ol className="recipe-steps" aria-label="Recipe steps">
            {recipe.steps.map((step, index) => {
              const operation = registry.has(step.operationId) ? registry.get(step.operationId) : null;
              const stepResult = stepResults.get(step.id);
              return (
                <li
                  key={step.id}
                  className={`recipe-step ${step.enabled ? '' : 'disabled'} ${dragIndex === index ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) move(dragIndex, index);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <div className="step-header">
                    <span className="drag-handle" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <label className="option-checkbox">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={(event) => updateStep(step.id, { enabled: event.target.checked })}
                        aria-label={`Enable step ${index + 1}`}
                      />
                      <strong>
                        {index + 1}. {operation?.name || step.operationId}
                      </strong>
                    </label>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move step ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move step ${index + 1} down`}
                      disabled={index === recipe.steps.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove step ${index + 1}`}
                      onClick={() => removeStep(step.id)}
                    >
                      ×
                    </button>
                  </div>
                  {operation && (
                    <OperationOptionsForm
                      operation={operation}
                      values={step.options}
                      onChange={(options) => updateStep(step.id, { options })}
                      compact
                    />
                  )}
                  {stepResult && (
                    <details className="step-output">
                      <summary>
                        {stepResult.error
                          ? `❌ ${stepResult.error}`
                          : `Output · ${stats(stepResult.output)} · ${stepResult.ms} ms`}
                      </summary>
                      {!stepResult.error && <pre>{stepResult.output.slice(0, 20000)}</pre>}
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn" onClick={() => setPicker(true)}>
            + Add step
          </button>
          <div className="recipe-library">
            <select aria-label="Saved recipes" value="" onChange={(event) => loadRecipe(event.target.value)}>
              <option value="">Load saved recipe…</option>
              {saved.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-small" onClick={saveRecipe}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={deleteRecipe}
              disabled={!saved.some((item) => item.id === recipe.id)}
            >
              Delete
            </button>
            <button type="button" className="btn btn-small" onClick={() => setRecipe(createRecipe())}>
              New
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() =>
                downloadText(
                  serializeRecipe(recipe),
                  `${recipe.name.replace(/[^\w.-]+/g, '-') || 'recipe'}.speculo-recipe.json`,
                  'application/json',
                )
              }
            >
              Export
            </button>
            <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <button type="button" className="btn btn-small" onClick={shareLink}>
              Share link
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importRecipe} />
          </div>
        </div>

        <div className="workbench-io">
          <div className="io-header">
            <label htmlFor="workbench-output">Output</label>
            <span className="muted">{stats(result.output)}</span>
            <button
              type="button"
              className="btn btn-small"
              disabled={!result.output}
              onClick={() => navigator.clipboard?.writeText(result.output).then(() => notify('Output copied.'))}
            >
              Copy
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={!result.output}
              onClick={() => onInsert(result.output)}
            >
              Insert into document
            </button>
          </div>
          {result.error && (
            <p className="error-text" role="alert">
              {result.error}
            </p>
          )}
          <textarea id="workbench-output" value={result.output ?? ''} readOnly spellCheck={false} />
        </div>
      </div>
      {picker && (
        <OperationPalette
          registry={registry}
          mode="pick"
          onClose={() => setPicker(false)}
          onRun={(operationId, options) => addStep(operationId, options)}
        />
      )}
    </section>
  );
}
