// Runs operations off the main thread. The client terminates this worker on timeout/cancel, which stops even
// synchronous CPU-bound work.
import { defaultRegistry } from '../operations/catalog.js';
import { runOperation, unwrapResult } from '../operations/registry.js';
import { isBytes } from '../operations/bytes.js';

self.onmessage = async (event) => {
  const { id, operationId, input, options } = event.data;
  try {
    const result = unwrapResult(
      await runOperation(defaultRegistry.get(operationId), input, options, { timeoutMs: Infinity }),
    );
    const transfer = isBytes(result.output) ? [result.output.buffer] : [];
    self.postMessage({ id, ok: true, output: result.output, warnings: result.warnings }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message });
  }
};
