import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_ORDER, allOperations, defaultRegistry, orderedGroups } from './catalog.js';
import { OUTPUT_MODES } from './registry.js';

const root = fileURLToPath(new URL('.', import.meta.url));
function testSources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testSources(path);
    return name.endsWith('.test.js') ? [readFileSync(path, 'utf8')] : [];
  });
}
const allTests = testSources(root).join('\n');

describe('operation catalog', () => {
  it('registers every operation with unique ids', () => {
    expect(defaultRegistry.list.length).toBe(allOperations.length);
    expect(new Set(allOperations.map((op) => op.id)).size).toBe(allOperations.length);
    expect(defaultRegistry.list.length).toBeGreaterThan(230);
  });

  it('has complete, consistent metadata', () => {
    for (const operation of defaultRegistry.list) {
      expect(operation.description.length, operation.id).toBeGreaterThan(5);
      expect(OUTPUT_MODES).toContain(operation.outputMode);
      expect(['selection', 'document']).toContain(operation.inputScope);
      expect(CATEGORY_ORDER, `${operation.id} category ${operation.category}`).toContain(operation.category);
      if (operation.inverse)
        expect(defaultRegistry.has(operation.inverse), `${operation.id} inverse ${operation.inverse}`).toBe(true);
      if (operation.potentiallyLossy) expect(operation.lossyWarning, `${operation.id} lossy warning`).toBeTruthy();
      expect(operation.networkAccess, `${operation.id} must be local`).toBe(false);
      for (const option of operation.options) expect(option.label, `${operation.id}.${option.key}`).toBeTruthy();
    }
  });

  it('labels insecure algorithms and one-way hashes', () => {
    expect(defaultRegistry.get('hash.md5').insecure).toBe(true);
    expect(defaultRegistry.get('hash.sha-256').notes).toMatch(/one-way/);
  });

  it('has a test that exercises every operation id', () => {
    // Encoding pairs are exercised by the inverse round-trip loop in encoding.test.js.
    const roundTripped = new Set(
      defaultRegistry.list
        .filter((op) => op.category === 'Encoding' && op.inverse)
        .flatMap((op) => [op.id, op.inverse]),
    );
    // Extractors are generated from one table and tested through `extract(text, kind)`.
    const untested = defaultRegistry.list
      .map((op) => op.id)
      .filter(
        (id) =>
          !roundTripped.has(id) &&
          !id.startsWith('extract.') &&
          !allTests.includes(`'${id}'`) &&
          !allTests.includes(`"${id}"`),
      );
    expect(untested).toEqual([]);
  });

  it('orders groups for menus', () => {
    const groups = orderedGroups();
    expect(groups[0].category).toBe('Format');
    expect(groups.at(-1).category).toBe('Generate');
  });
});
