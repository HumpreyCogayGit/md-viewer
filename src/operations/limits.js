export class OperationTimeoutError extends Error {
  constructor(ms) {
    super(`Operation timed out after ${ms} ms.`);
    this.name = 'OperationTimeoutError';
  }
}

export class OperationCancelledError extends Error {
  constructor() {
    super('Operation cancelled.');
    this.name = 'OperationCancelledError';
  }
}

/**
 * Race a promise against a deadline and an optional AbortSignal.
 * Synchronous work cannot be interrupted on the main thread; use the worker runner for that.
 */
export function withDeadline(promise, ms, signal) {
  if (signal?.aborted) return Promise.reject(new OperationCancelledError());
  if (!ms || ms === Infinity) {
    if (!signal) return promise;
  }

  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OperationCancelledError());
    };
    if (ms && ms !== Infinity) {
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        reject(new OperationTimeoutError(ms));
      }, ms);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Throw if a decompressed/expanded output would exceed a limit (expansion-bomb guard). */
export function assertExpansionWithin(outputSize, inputSize, { maxBytes = 50 * 1024 * 1024, maxRatio = 1000 } = {}) {
  if (outputSize > maxBytes) throw new Error(`Output exceeds the ${maxBytes.toLocaleString()} byte limit.`);
  if (inputSize > 0 && outputSize / inputSize > maxRatio) {
    throw new Error(`Output expanded more than ${maxRatio}× the input; refusing to continue.`);
  }
}
