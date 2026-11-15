import { useId } from 'react';

/** Renders option controls from an operation's options schema. */
export function OperationOptionsForm({ operation, values, onChange, compact = false }) {
  const baseId = useId();
  if (!operation.options.length) return null;
  const set = (key, value) => onChange({ ...values, [key]: value });
  return (
    <div className={`options-form ${compact ? 'options-form-compact' : ''}`}>
      {operation.options.map((option) => {
        const id = `${baseId}-${option.key}`;
        const value = values[option.key] ?? option.default;
        if (option.type === 'boolean') {
          return (
            <label key={option.key} className="option-row option-checkbox" htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => set(option.key, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          );
        }
        return (
          <div key={option.key} className="option-row">
            <label htmlFor={id}>{option.label}</label>
            {option.type === 'select' && (
              <select
                id={id}
                value={String(value)}
                onChange={(event) =>
                  set(
                    option.key,
                    option.choices.find((choice) => String(choice.value) === event.target.value)?.value ??
                      event.target.value,
                  )
                }
              >
                {option.choices.map((choice) => (
                  <option key={String(choice.value)} value={String(choice.value)}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
            {option.type === 'number' && (
              <input
                id={id}
                type="number"
                value={value}
                min={option.min}
                max={option.max}
                onChange={(event) => set(option.key, event.target.value === '' ? '' : Number(event.target.value))}
              />
            )}
            {option.type === 'text' && (
              <input
                id={id}
                type="text"
                value={value}
                spellCheck={false}
                onChange={(event) => set(option.key, event.target.value)}
              />
            )}
            {option.type === 'textarea' && (
              <textarea
                id={id}
                value={value}
                rows={4}
                spellCheck={false}
                onChange={(event) => set(option.key, event.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export const defaultOptionValues = (operation) =>
  Object.fromEntries(operation.options.map((option) => [option.key, option.default]));

export function OperationBadges({ operation }) {
  const badges = [];
  if (operation.potentiallyLossy) badges.push(['lossy', 'May lose information']);
  if (operation.insecure) badges.push(['insecure', 'Cryptographically insecure']);
  if (operation.networkAccess) badges.push(['network', 'Uses the network']);
  if (operation.outputMode === 'report') badges.push(['report', 'Shows a report']);
  if (operation.isGenerator) badges.push(['generator', 'Inserts at cursor']);
  if (operation.inputScope === 'document') badges.push(['document', 'Whole document']);
  if (operation.expensive) badges.push(['expensive', 'Runs in background']);
  if (badges.length === 0) return null;
  return (
    <span className="badges">
      {badges.map(([kind, label]) => (
        <span key={kind} className={`badge badge-${kind}`} title={label}>
          {label}
        </span>
      ))}
    </span>
  );
}
