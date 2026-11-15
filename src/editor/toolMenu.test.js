import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../operations/catalog.js';
import { TOOL_GROUPS, buildToolMenu } from './toolMenu.js';

describe('right-click tools menu model', () => {
  it('puts suggestions for the selection first', () => {
    const entries = buildToolMenu(defaultRegistry, { selectionText: 'aGVsbG8gd29ybGQ=' });
    expect(entries[0]).toMatchObject({ type: 'heading', label: 'Suggested for selection' });
    expect(entries[1]).toMatchObject({ type: 'item', operationId: 'decode.base64' });
  });

  it('shows recent tools without repeating suggestions', () => {
    const entries = buildToolMenu(defaultRegistry, {
      selectionText: 'aGVsbG8gd29ybGQ=',
      recents: ['decode.base64', 'case.upper', 'nope'],
    });
    const recentIndex = entries.findIndex((e) => e.label === 'Recent');
    expect(entries[recentIndex + 1].operationId).toBe('case.upper');
    expect(entries.filter((e) => e.operationId === 'decode.base64')).toHaveLength(1);
  });

  it('offers every operation through a category submenu', () => {
    const entries = buildToolMenu(defaultRegistry, {});
    const inSubmenus = new Set(
      entries.filter((e) => e.type === 'submenu').flatMap((e) => e.items.map((i) => i.operationId)),
    );
    const missing = defaultRegistry.list.filter((op) => !inSubmenus.has(op.id)).map((op) => op.id);
    expect(missing).toEqual([]);
    expect(entries.filter((e) => e.type === 'submenu').map((e) => e.label)).toEqual(TOOL_GROUPS.map((g) => g.label));
  });

  it('splits encode and decode', () => {
    const entries = buildToolMenu(defaultRegistry, {});
    const encode = entries.find((e) => e.label === 'Encode').items.map((i) => i.operationId);
    const decode = entries.find((e) => e.label === 'Decode').items.map((i) => i.operationId);
    expect(encode).toContain('encode.base64');
    expect(decode).toContain('decode.base64');
    expect(encode.some((id) => id.startsWith('decode.'))).toBe(false);
  });

  it('includes search, workbench and clipboard actions; cut/paste only in the editor', () => {
    const editor = buildToolMenu(defaultRegistry, { selectionText: 'x', pane: 'editor' })
      .map((e) => e.action)
      .filter(Boolean);
    expect(editor).toEqual(['palette', 'workbench', 'cut', 'copy', 'paste']);
    const preview = buildToolMenu(defaultRegistry, { selectionText: 'x', pane: 'preview' })
      .map((e) => e.action)
      .filter(Boolean);
    expect(preview).toEqual(['palette', 'workbench', 'copy']);
    const empty = buildToolMenu(defaultRegistry, { selectionText: '' });
    expect(empty.find((e) => e.action === 'copy').disabled).toBe(true);
    expect(empty[0].type).toBe('submenu');
  });
});
