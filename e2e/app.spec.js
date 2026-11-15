import { expect, test } from '@playwright/test';
import { editorValue, openApp, runFromPalette, select } from './helpers.js';

test('loads without errors and without third-party requests', async ({ page }) => {
  const problems = [];
  const external = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  page.on(
    'request',
    (request) =>
      !request.url().startsWith('http://localhost:4173') &&
      !request.url().startsWith('data:') &&
      external.push(request.url()),
  );
  await openApp(page);
  await expect(page.locator('.mermaid-diagram svg')).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.preview-area').getByText('<!-- toc -->')).toHaveCount(0);
  expect(problems).toEqual([]);
  expect(external).toEqual([]);
});

test('opens a file chosen with the file picker fallback', async ({ page }) => {
  await openApp(page);
  await page
    .locator('input[type="file"][accept*=".md"]')
    .setInputFiles({ name: 'NOTES.MD', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\nHello') });
  await expect(page.getByRole('tab', { name: /NOTES\.MD/ })).toBeVisible();
  expect(await editorValue(page)).toBe('# Notes\n\nHello');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
});

test('converts a selection and undoes it with the caret restored', async ({ page }) => {
  await openApp(page, { content: 'before hello after' });
  await select(page, 7, 12);
  await runFromPalette(page, 'base64 encode');
  await expect.poll(() => editorValue(page)).toBe('before aGVsbG8= after');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => editorValue(page)).toBe('before hello after');
  const caret = await page.getByLabel('Markdown source').evaluate((el) => [el.selectionStart, el.selectionEnd]);
  expect(caret).toEqual([7, 12]);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(() => editorValue(page)).toBe('before aGVsbG8= after');
});

test('beautifies the fenced block around the cursor', async ({ page }) => {
  await openApp(page, { content: 'Text\n\n```json\n{"a":12345678901234567890}\n```\n' });
  await select(page, 15, 15);
  await runFromPalette(page, 'beautify json');
  await expect.poll(() => editorValue(page)).toBe('Text\n\n```json\n{\n    "a": 12345678901234567890\n}\n```\n');
});

test('invalid input is reported and never changes the document', async ({ page }) => {
  await openApp(page, { content: '{"a": }' });
  await select(page, 0, 7);
  await runFromPalette(page, 'beautify json');
  await expect(page.getByRole('alert')).toContainText('line 1, column 7');
  expect(await editorValue(page)).toBe('{"a": }');
});

test('lossy operations show a preview first', async ({ page }) => {
  await openApp(page, { content: 'Crème Brûlée' });
  await select(page, 0, 12);
  await runFromPalette(page, 'remove diacritics');
  const dialog = page.getByRole('dialog', { name: /Preview: Remove Diacritics/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Accents are removed permanently');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await editorValue(page)).toBe('Crème Brûlée');
  await select(page, 0, 12);
  await runFromPalette(page, 'remove diacritics');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Replace/ })
    .click();
  await expect.poll(() => editorValue(page)).toBe('Creme Brulee');
});

test('report operations open a result panel without modifying the document', async ({ page }) => {
  await openApp(page, { content: 'abc' });
  await select(page, 0, 3);
  await runFromPalette(page, 'sha-256');
  const panel = page.getByRole('complementary', { name: /SHA-256 result/ });
  await expect(panel).toContainText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await editorValue(page)).toBe('abc');
});

test('generators insert at the cursor without a selection', async ({ page }) => {
  await openApp(page, { content: 'id: ' });
  await select(page, 4, 4);
  await runFromPalette(page, 'uuid', '^UUID');
  await expect.poll(() => editorValue(page)).toMatch(/^id: [0-9a-f-]{36}$/);
});

test('asks before running on the whole document', async ({ page }) => {
  await openApp(page, { content: 'shout' });
  await select(page, 2, 2);
  await runFromPalette(page, 'upper case');
  const dialog = page.getByRole('dialog', { name: /whole document/ });
  await dialog.getByRole('button', { name: 'Apply to whole document' }).click();
  await expect.poll(() => editorValue(page)).toBe('SHOUT');
});

test('keyboard shortcuts: bold, indent, outdent, Escape releases Tab', async ({ page }) => {
  const editor = await openApp(page, { content: 'word\na\nb' });
  await select(page, 0, 4);
  await page.keyboard.press('ControlOrMeta+B');
  await expect.poll(() => editorValue(page)).toBe('**word**\na\nb');
  await select(page, 9, 12);
  await page.keyboard.press('Tab');
  await expect.poll(() => editorValue(page)).toBe('**word**\n  a\n  b');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => editorValue(page)).toBe('**word**\na\nb');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
});

test('find and replace all', async ({ page }) => {
  await openApp(page, { content: 'cat hat cat' });
  await select(page, 0, 0);
  await page.keyboard.press('ControlOrMeta+Alt+F');
  await page.getByLabel('Find', { exact: true }).fill('cat');
  await expect(page.locator('.find-count')).toContainText('of 2');
  await page.getByLabel('Replace with').fill('dog');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect.poll(() => editorValue(page)).toBe('dog hat dog');
});

test('saving downloads the Markdown file and PDF export downloads a PDF', async ({ page }) => {
  await openApp(page, { content: '# Title\n\n- a\n  - nested\n\n```js\nlet x = 1;\n```' });
  const markdown = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+S');
  expect((await markdown).suggestedFilename()).toBe('document.md');
  await page.getByRole('button', { name: 'Main menu' }).click();
  const pdf = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export to PDF' }).click();
  const download = await pdf;
  expect(download.suggestedFilename()).toBe('document.pdf');
  const { readFile } = await import('node:fs/promises');
  const bytes = (await readFile(await download.path())).toString('latin1');
  expect(bytes.startsWith('%PDF')).toBe(true);
  expect(bytes).toContain('/BaseFont /Courier');
});

test('autosaves and restores after reload', async ({ page }) => {
  await openApp(page, { content: 'Remember me' });
  await page.waitForTimeout(700);
  await page.reload();
  await expect.poll(() => editorValue(page)).toBe('Remember me');
});

test('menu is keyboard accessible and returns focus on Escape', async ({ page }) => {
  await openApp(page);
  const button = page.getByRole('button', { name: 'Main menu' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /^Open/ }).first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('divider is keyboard adjustable', async ({ page }) => {
  await openApp(page);
  const separator = page.getByRole('separator', { name: 'Resize editor and preview' });
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '52');
});

test('theme toggle re-renders Mermaid diagrams', async ({ page }) => {
  await openApp(page);
  const svg = page.locator('.mermaid-diagram svg');
  await expect(svg).toBeVisible();
  const before = await svg.evaluate((el) => el.outerHTML.length);
  await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
  await expect.poll(async () => svg.evaluate((el) => el.outerHTML.length)).not.toBe(before);
});

test('workbench runs a recipe without touching the document', async ({ page }) => {
  await openApp(page, { content: 'doc' });
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await page.getByLabel('Input', { exact: true }).fill('  hi  ');
  await page.getByRole('button', { name: '+ Add step' }).click();
  await page.getByRole('combobox', { name: 'Search operations' }).fill('trim lines');
  await page.getByRole('combobox', { name: 'Search operations' }).press('Enter');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await page.getByRole('button', { name: '+ Add step' }).click();
  await page.getByRole('combobox', { name: 'Search operations' }).fill('base64 encode');
  await page.getByRole('combobox', { name: 'Search operations' }).press('Enter');
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(page.getByLabel('Output', { exact: true })).toHaveValue('aGk=');
  expect(await editorValue(page)).toBe('doc');
});

test('pasting spreadsheet cells creates a Markdown table', async ({ page }) => {
  await openApp(page, { content: '' });
  await select(page, 0, 0);
  await page.getByLabel('Markdown source').evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Name\tQty\napple\t3');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => editorValue(page)).toBe('| Name  | Qty |\n| ----- | --- |\n| apple | 3   |');
});

test('narrow screens switch between editor and preview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openApp(page, { content: '# Mobile' });
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Mobile' })).toBeVisible();
  await expect(page.getByLabel('Markdown source')).toBeHidden();
});

test('expensive operations run in a Web Worker (gzip round trip)', async ({ page }) => {
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await openApp(page, { content: 'compress me please' });
  await select(page, 0, 18);
  await runFromPalette(page, 'compress gzip');
  await expect.poll(() => editorValue(page)).toMatch(/^H4sI/);
  expect(workers.some((url) => /operationWorker/.test(url))).toBe(true);
  const value = await editorValue(page);
  await select(page, 0, value.length);
  await runFromPalette(page, 'decompress gunzip');
  await expect.poll(() => editorValue(page)).toBe('compress me please');
});

test('suggests operations for the selection in the palette', async ({ page }) => {
  await openApp(page, { content: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln' });
  await select(page, 0, 41);
  await page.keyboard.press('ControlOrMeta+Shift+P');
  await expect(page.getByRole('group', { name: 'Suggested for this selection' })).toContainText('Decode JWT');
});

test('right-click a selection to apply a suggested tool', async ({ page }) => {
  const editor = await openApp(page, { content: 'Token: aGVsbG8gd29ybGQ=' });
  await select(page, 7, 23);
  const box = await editor.boundingBox();
  await page.mouse.click(box.x + 200, box.y + 30, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Tools' });
  await expect(menu).toBeVisible();
  await menu
    .getByRole('menuitem', { name: /Base64 Decode/ })
    .first()
    .click();
  await expect.poll(() => editorValue(page)).toBe('Token: hello world');
});

test('right-click submenus run tools, and tools needing input open their options', async ({ page }) => {
  const editor = await openApp(page, { content: 'b\na\nc' });
  await select(page, 0, 5);
  const box = await editor.boundingBox();
  await page.mouse.click(box.x + 200, box.y + 30, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Lines/ }).hover();
  await page.getByRole('menu', { name: 'Lines' }).getByRole('menuitem', { name: 'Sort Lines' }).click();
  await expect.poll(() => editorValue(page)).toBe('a\nb\nc');

  await select(page, 0, 5);
  await page.mouse.click(box.x + 200, box.y + 30, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Lines/ }).hover();
  await page.getByRole('menu', { name: 'Lines' }).getByRole('menuitem', { name: 'Filter Lines' }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter Lines' });
  await dialog.getByLabel('Text or pattern').fill('b');
  await dialog.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => editorValue(page)).toBe('b');
});

test('Shift+F10 opens the tools menu from the keyboard; Shift+right-click keeps the browser menu', async ({ page }) => {
  await openApp(page, { content: 'shout' });
  await select(page, 0, 5);
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Tools' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  const box = await page.getByLabel('Markdown source').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + 100, box.y + 30, { button: 'right' });
  await page.keyboard.up('Shift');
  await expect(menu).toBeHidden();
});

test('right-clicking text selected in the preview applies the tool to the source', async ({ page }) => {
  await openApp(page, { content: 'first word\n\nrepeat here\n\nrepeat there' });
  const target = page.locator('.preview-area p').nth(2);
  // Double-click the first word (the paragraph is wider than its text).
  await target.dblclick({ position: { x: 12, y: 10 } });
  await expect.poll(() => page.evaluate(() => window.getSelection().toString().trim())).toBe('repeat');
  await target.click({ button: 'right', position: { x: 12, y: 10 } });
  await page.getByRole('menuitem', { name: /^Text/ }).hover();
  await page.getByRole('menu', { name: 'Text' }).getByRole('menuitem', { name: 'UPPER CASE' }).click();
  await expect.poll(() => editorValue(page)).toBe('first word\n\nrepeat here\n\nREPEAT there');
});
