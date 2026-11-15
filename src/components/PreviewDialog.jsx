import { useRef } from 'react';
import { Dialog } from './Dialog.jsx';
import { byteLength } from '../operations/bytes.js';

const stats = (text) =>
  `${text.length.toLocaleString()} chars · ${text.split('\n').length.toLocaleString()} lines · ${byteLength(text).toLocaleString()} bytes`;

/**
 * Before/after preview for an operation result. Nothing changes until the user picks Replace or Insert below.
 */
export function PreviewDialog({
  operation,
  input,
  output,
  warnings = [],
  targetLabel,
  onReplace,
  onInsert,
  onCopy,
  onDownload,
  onCancel,
}) {
  const replaceRef = useRef(null);
  const allWarnings = [
    ...(operation.lossyWarning ? [operation.lossyWarning] : []),
    ...(operation.insecure ? ['This algorithm is cryptographically insecure; use it only for compatibility.'] : []),
    ...(operation.networkAccess ? ['This operation contacts a remote service.'] : []),
    ...warnings,
  ];
  return (
    <Dialog
      title={`Preview: ${operation.name}`}
      onClose={onCancel}
      initialFocusRef={replaceRef}
      wide
      className="preview-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="btn" onClick={onDownload}>
            Download
          </button>
          <button type="button" className="btn" onClick={onInsert}>
            Insert below
          </button>
          <button type="button" ref={replaceRef} className="btn btn-primary" onClick={onReplace}>
            Replace {targetLabel ? targetLabel.replace(/^the /, '') : 'selection'}
          </button>
        </>
      }
    >
      {allWarnings.length > 0 && (
        <ul className="warning-list" aria-label="Warnings">
          {allWarnings.map((warning) => (
            <li key={warning}>⚠️ {warning}</li>
          ))}
        </ul>
      )}
      <div className="preview-columns">
        <section aria-label="Original">
          <h3>
            Original <span className="muted">{stats(input)}</span>
          </h3>
          <pre className="preview-pane" tabIndex={0}>
            {input}
          </pre>
        </section>
        <section aria-label="Result">
          <h3>
            Result <span className="muted">{stats(output)}</span>
          </h3>
          <pre className="preview-pane" tabIndex={0}>
            {output}
          </pre>
        </section>
      </div>
    </Dialog>
  );
}
