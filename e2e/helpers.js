import { expect } from '@playwright/test';

/** Start from a clean slate: no stored documents, analytics declined, and no File System Access API (forces downloads). */
export async function openApp(page, { content, consent = 'denied', fileSystemAccess = false } = {}) {
  await page.addInitScript(
    ({ consent, fileSystemAccess }) => {
      if (!sessionStorage.getItem('e2e-initialised')) {
        localStorage.clear();
        if (consent) localStorage.setItem('speculo.analyticsConsent.v1', JSON.stringify(consent));
        sessionStorage.setItem('e2e-initialised', '1');
      }
      if (!fileSystemAccess) {
        for (const name of ['showOpenFilePicker', 'showSaveFilePicker'])
          Object.defineProperty(window, name, { value: undefined, configurable: true });
      }
    },
    { consent, fileSystemAccess },
  );
  await page.goto('/');
  const editor = page.getByLabel('Markdown source');
  await expect(editor).toBeVisible();
  if (content !== undefined) {
    await editor.fill(content);
  }
  return editor;
}

export async function select(page, start, end) {
  await page.getByLabel('Markdown source').evaluate(
    (el, [s, e]) => {
      el.focus();
      el.setSelectionRange(s, e);
      el.dispatchEvent(new Event('select', { bubbles: true }));
    },
    [start, end],
  );
}

export async function runFromPalette(page, query, optionName) {
  await page.keyboard.press('ControlOrMeta+Shift+P');
  const search = page.getByRole('combobox', { name: 'Search operations' });
  await expect(search).toBeVisible();
  await search.fill(query);
  if (optionName)
    await page
      .getByRole('option', { name: new RegExp(optionName) })
      .first()
      .click();
  else await search.press('Enter');
}

export const editorValue = (page) => page.getByLabel('Markdown source').inputValue();
