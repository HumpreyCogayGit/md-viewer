import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  createDataConversionOperations,
  createOperationRegistry,
  defineOperation,
  executeOperationOnSelection,
} from './index.js';

const labels = { json: 'JSON', xml: 'XML', yaml: 'YAML' };
const languages = {
  json: new Set(['json']),
  xml: new Set(['xml']),
  yaml: new Set(['yaml', 'yml']),
};

function createTestRegistry() {
  const operations = createDataConversionOperations({
    labels,
    languages,
    validate: (input, format) => input.trim().startsWith(`${format}:`),
    convert: (input, source, target) => `${target}:${input.trim().slice(source.length + 1)}`,
  });
  return createOperationRegistry(operations);
}

describe('operation registry', () => {
  it('registers and executes a standalone operation', async () => {
    const uppercase = defineOperation({
      id: 'text.uppercase',
      name: 'Uppercase',
      description: 'Convert text to uppercase.',
      category: 'Text',
      inputType: 'text',
      outputType: 'text',
      run: (input) => input.toUpperCase(),
    });
    const registry = createOperationRegistry([uppercase]);

    assert.equal(await registry.execute('text.uppercase', 'Speculo'), 'SPECULO');
    assert.deepEqual(registry.byCategory('Text'), [uppercase]);
  });

  it('rejects duplicate ids and unknown operations', () => {
    const operation = defineOperation({
      id: 'text.identity',
      name: 'Identity',
      description: 'Return the input.',
      category: 'Text',
      inputType: 'text',
      outputType: 'text',
      run: (input) => input,
    });

    assert.throws(() => createOperationRegistry([operation, operation]), /Duplicate operation id/);
    assert.throws(() => createOperationRegistry().get('missing'), /Unknown operation/);
  });
});

describe('structured data operations', () => {
  it('creates all six conversion directions with metadata', () => {
    const registry = createTestRegistry();
    const operation = registry.get('data.json-to-yaml');

    assert.equal(registry.list.length, 6);
    assert.equal(operation.name, 'JSON → YAML');
    assert.equal(operation.category, 'Structured Data');
    assert.equal(operation.inputType, 'json');
    assert.equal(operation.outputType, 'yaml');
    assert.deepEqual([...operation.inputLanguages], ['json']);
    assert.equal(operation.outputLanguage, 'yaml');
    assert.equal(operation.supportsSelection, true);
    assert.equal(operation.supportsFencedBlock, true);
    assert.equal(operation.potentiallyLossy, false);
    assert.equal(operation.networkAccess, false);
    assert.equal(operation.outputMode, 'replace');
    assert.equal(operation.inverse, 'data.yaml-to-json');
    assert.equal(registry.get('data.xml-to-json').potentiallyLossy, true);
    assert.match(registry.get('data.xml-to-json').lossyWarning, /comments/);
  });

  it('validates plain selections before executing', async () => {
    const registry = createTestRegistry();
    const operation = registry.get('data.json-to-yaml');

    assert.equal(await executeOperationOnSelection(operation, 'json:{"ok":true}'), 'yaml:{"ok":true}');
    await assert.rejects(() => executeOperationOnSelection(operation, 'not json'), /Invalid JSON/);
  });

  it('transforms matching fenced blocks and preserves unrelated blocks', async () => {
    const registry = createTestRegistry();
    const operation = registry.get('data.json-to-yaml');
    const input = '```json\njson:{"ok":true}\n```\n\n```text\nkeep me\n```';

    assert.equal(
      await executeOperationOnSelection(operation, input),
      '```yaml\nyaml:{"ok":true}\n```\n\n```text\nkeep me\n```',
    );
  });
});
