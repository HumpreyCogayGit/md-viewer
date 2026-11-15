import { runOperation, unwrapResult } from './registry.js';
import { byteLength } from './bytes.js';
import { OperationCancelledError, OperationTimeoutError } from './limits.js';

/** Inputs larger than this run in a worker even if the operation is not marked expensive. */
export const WORKER_THRESHOLD_BYTES = 256 * 1024;

export function shouldUseWorker(operation, input) {
  return operation.expensive || byteLength(input ?? '') > WORKER_THRESHOLD_BYTES;
}

const defaultWorkerFactory = () =>
  typeof Worker === 'undefined'
    ? null
    : new Worker(new URL('../workers/operationWorker.js', import.meta.url), { type: 'module' });

let messageId = 0;

/**
 * Run an operation in a dedicated Web Worker with a hard deadline and real cancellation (the worker is terminated).
 * Falls back to the main thread when workers are unavailable. Resolves to { output, warnings }.
 */
export function runInWorker(
  operation,
  input,
  options = {},
  { signal, timeoutMs = operation.timeoutMs, workerFactory = defaultWorkerFactory } = {},
) {
  const worker = workerFactory();
  if (!worker) {
    return runOperation(operation, input, options, { signal, timeoutMs }).then(unwrapResult);
  }
  return new Promise((resolve, reject) => {
    const id = (messageId += 1);
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      cleanup();
      reject(new OperationCancelledError());
    };
    if (signal?.aborted) {
      worker.terminate();
      reject(new OperationCancelledError());
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs && timeoutMs !== Infinity) {
      timer = setTimeout(() => {
        cleanup();
        reject(new OperationTimeoutError(timeoutMs));
      }, timeoutMs);
    }
    worker.onmessage = (event) => {
      if (event.data?.id !== id) return;
      cleanup();
      if (event.data.ok) resolve({ output: event.data.output, warnings: event.data.warnings || [] });
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'The operation worker crashed.'));
    };
    worker.postMessage({ id, operationId: operation.id, input, options });
  });
}

/** Run on the main thread or in a worker depending on cost. */
export function runSmart(operation, input, options, context = {}) {
  if (shouldUseWorker(operation, input)) return runInWorker(operation, input, options, context);
  return runOperation(operation, input, options, context).then(unwrapResult);
}
