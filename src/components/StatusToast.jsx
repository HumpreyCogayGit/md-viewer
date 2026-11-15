import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Status messages with an explicit type (success | error | info | warning) and a single timer, so a newer message is
 * never cleared by an older message's timeout.
 */
export function useStatus(defaultDuration = 3500) {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
    setStatus(null);
  }, []);

  const show = useCallback(
    (message, type = 'success', duration = type === 'error' ? 6000 : defaultDuration) => {
      clearTimeout(timerRef.current);
      setStatus({ message, type, id: Date.now() + Math.random() });
      if (duration > 0) timerRef.current = setTimeout(() => setStatus(null), duration);
    },
    [defaultDuration],
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);
  return { status, show, clear };
}

export function StatusToast({ status, onDismiss }) {
  return (
    <>
      {/* Live regions stay mounted so screen readers announce updates. */}
      <div className="sr-only" role="status" aria-live="polite">
        {status && status.type !== 'error' ? status.message : ''}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive">
        {status && status.type === 'error' ? status.message : ''}
      </div>
      {status && (
        <div className={`toast toast-${status.type}`} key={status.id}>
          <span>{status.message}</span>
          <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
    </>
  );
}
