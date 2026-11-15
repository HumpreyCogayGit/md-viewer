// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRegistry } from '../operations/catalog.js';
import { OperationPalette, needsInput } from './OperationPalette.jsx';
import { PreviewDialog } from './PreviewDialog.jsx';
import { ResultPanel } from './ResultPanel.jsx';
import { StatusToast, useStatus } from './StatusToast.jsx';
import { AppMenu } from './AppMenu.jsx';
import { OperationOptionsForm } from './OperationOptionsForm.jsx';
import { ConfirmDialog } from './Dialog.jsx';
import { FindReplaceBar } from './FindReplaceBar.jsx';
import { MarkdownPreview, urlTransform } from './MarkdownPreview.jsx';
import { ShortcutsDialog, StatusBar, TabBar } from './Panels.jsx';

beforeEach(() => localStorage.clear());

describe('OperationPalette', () => {
  it('searches by alias and runs the highlighted operation with Enter', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<OperationPalette registry={defaultRegistry} onRun={onRun} onClose={() => {}} />);
    const search = screen.getByRole('combobox', { name: 'Search operations' });
    expect(search).toHaveFocus();
    await user.type(search, 'b64');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Base64 Encode');
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onRun).toHaveBeenCalledWith('encode.base64', {}, { preview: false });
  });

  it('keeps relevance order across categories (regression)', async () => {
    const user = userEvent.setup();
    render(<OperationPalette registry={defaultRegistry} onRun={() => {}} onClose={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'upper case');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('UPPER CASE');
  });

  it('opens the option form when an option needs input, and with Shift+Enter', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<OperationPalette registry={defaultRegistry} onRun={onRun} onClose={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'find and replace');
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Find and Replace' });
    await user.type(within(dialog).getByLabelText('Find'), 'a');
    await user.type(within(dialog).getByLabelText('Replace with'), 'b');
    await user.click(within(dialog).getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledWith('text.find-replace', expect.objectContaining({ find: 'a', replace: 'b' }), {
      preview: true,
    });
    expect(needsInput(defaultRegistry.get('encode.base64'))).toBe(false);
  });

  it('shows warning badges, suggestions, favourites and recents', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const { unmount } = render(
      <OperationPalette
        registry={defaultRegistry}
        onRun={onRun}
        onClose={() => {}}
        suggestions={[{ operationId: 'jwt.decode', reason: 'Looks like a JSON Web Token' }]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Suggested for this selection' })).toHaveTextContent(
      'Looks like a JSON Web Token',
    );
    await user.type(screen.getByRole('combobox'), 'md5');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Cryptographically insecure');
    await user.click(screen.getByRole('button', { name: 'Add MD5 (insecure) to favourites' }));
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Enter}');
    unmount();
    render(<OperationPalette registry={defaultRegistry} onRun={onRun} onClose={() => {}} />);
    expect(screen.getByRole('group', { name: 'Favourites' })).toHaveTextContent('MD5');
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OperationPalette registry={defaultRegistry} onRun={() => {}} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PreviewDialog', () => {
  it('shows original, result and warnings, and applies or cancels', async () => {
    const user = userEvent.setup();
    const handlers = { onReplace: vi.fn(), onInsert: vi.fn(), onCopy: vi.fn(), onDownload: vi.fn(), onCancel: vi.fn() };
    render(
      <PreviewDialog
        operation={defaultRegistry.get('data.xml-to-json')}
        input="<a/>"
        output='{"a":""}'
        warnings={['dynamic warning']}
        targetLabel="the selection"
        {...handlers}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Preview: XML → JSON' });
    expect(within(dialog).getByRole('region', { name: 'Original' })).toHaveTextContent('<a/>');
    expect(within(dialog).getByRole('region', { name: 'Result' })).toHaveTextContent('{"a":""}');
    expect(within(dialog).getByRole('list', { name: 'Warnings' })).toHaveTextContent('comments');
    expect(within(dialog).getByRole('list', { name: 'Warnings' })).toHaveTextContent('dynamic warning');
    expect(within(dialog).getByRole('button', { name: 'Replace selection' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Insert below' }));
    expect(handlers.onInsert).toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(handlers.onCancel).toHaveBeenCalled();
  });
});

describe('ResultPanel', () => {
  it('renders the report as Markdown with copy/insert/raw toggle', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(
      <ResultPanel
        result={{ title: 'SHA-256', output: '| a | b |\n|---|---|\n| 1 | 2 |', notes: 'Hashes are one-way.' }}
        onClose={() => {}}
        onCopy={() => {}}
        onInsert={onInsert}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/Hashes are one-way/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Insert at cursor' }));
    expect(onInsert).toHaveBeenCalled();
  });
});

describe('StatusToast (regression: wrong colours and overlapping timers)', () => {
  function Harness() {
    const { status, show, clear } = useStatus(1000);
    return (
      <>
        <button type="button" onClick={() => show('Invalid JSON at line 1', 'error')}>
          error
        </button>
        <button type="button" onClick={() => show('Done!', 'success')}>
          success
        </button>
        <StatusToast status={status} onDismiss={clear} />
      </>
    );
  }

  it('styles by explicit type, not by message text, and announces errors as alerts', async () => {
    render(<Harness />);
    act(() => screen.getByText('error').click());
    expect(document.querySelector('.toast')).toHaveClass('toast-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON at line 1');
  });

  it('a newer message is not cleared by an older timer', () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => screen.getByText('error').click()); // 6s timer
    act(() => vi.advanceTimersByTime(500));
    act(() => screen.getByText('success').click()); // 1s timer
    act(() => vi.advanceTimersByTime(900));
    expect(document.querySelector('.toast')).toHaveTextContent('Done!');
    expect(screen.getByRole('status')).toHaveTextContent('Done!');
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector('.toast')).toBeNull();
    vi.useRealTimers();
  });
});

describe('AppMenu', () => {
  it('supports keyboard navigation, Escape and focus return', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <AppMenu
        sections={[
          {
            title: 'File',
            items: [
              { label: 'Open…', onSelect: onOpen },
              { label: 'Save', onSelect: () => {} },
            ],
          },
          { title: 'View', items: [{ label: 'Sync scroll', checked: true, onSelect: () => {} }] },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Main menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open…' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Save' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitemcheckbox', { name: /Sync scroll/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(await screen.findByRole('menuitem', { name: 'Open…' }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('OperationOptionsForm', () => {
  it('renders controls from the schema and reports changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OperationOptionsForm operation={defaultRegistry.get('lines.sort')} values={{}} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Order'), 'desc');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ order: 'desc' }));
    await user.click(screen.getByLabelText('Case sensitive'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ caseSensitive: true }));
  });
});

describe('ConfirmDialog', () => {
  it('traps focus and confirms', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Apply?" message="Sure?" onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('FindReplaceBar', () => {
  it('counts matches and replaces all', async () => {
    const user = userEvent.setup();
    const onReplaceText = vi.fn();
    const onSelect = vi.fn();
    render(
      <FindReplaceBar
        text="a cat and a cat"
        selectionStart={0}
        showReplace
        onSelect={onSelect}
        onReplaceText={onReplaceText}
        onClose={() => {}}
      />,
    );
    await user.type(screen.getByLabelText('Find'), 'cat');
    expect(screen.getByText('0 of 2')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith({ start: 2, end: 5 });
    await user.type(screen.getByLabelText('Replace with'), 'dog');
    await user.click(screen.getByRole('button', { name: 'Replace all' }));
    expect(onReplaceText).toHaveBeenCalledWith('a dog and a dog', null, 'Replaced 2 occurrences.');
  });
});

describe('MarkdownPreview', () => {
  it('does not run block detectors on inline code (regression)', () => {
    const { container } = render(
      <MarkdownPreview markdown={'Inline `SELECT * FROM t` and `{"a":1}`.'} theme="light" />,
    );
    const codes = container.querySelectorAll('code');
    expect(codes).toHaveLength(2);
    codes.forEach((code) => expect(code.className).toBe(''));
    expect(container.querySelector('pre')).toBeNull();
  });

  it('strips dangerous URLs but keeps safe data images', () => {
    const { container } = render(
      <MarkdownPreview
        markdown={'[x](javascript:alert(1)) ![qr](data:image/svg+xml;base64,PHN2Zy8+) ![bad](data:text/html;base64,AA)'}
        theme="light"
      />,
    );
    expect(container.querySelector('a').getAttribute('href') || '').not.toMatch(/javascript/i);
    const images = container.querySelectorAll('img');
    expect(images[0].getAttribute('src')).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    expect(images[1].getAttribute('src') || '').not.toMatch(/text\/html/);
    expect(urlTransform('https://ok.test', 'href')).toBe('https://ok.test');
  });

  it('opens external links safely and blocks remote images on request', async () => {
    const onAllow = vi.fn();
    const { container } = render(
      <MarkdownPreview
        markdown={'[site](https://example.com) ![pic](https://example.com/p.png)'}
        theme="light"
        blockRemoteImages
        allowedImages={new Set()}
        onAllowImage={onAllow}
      />,
    );
    expect(container.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    const blocked = screen.getByRole('button', { name: /blocked for privacy/ });
    await userEvent.setup().click(blocked);
    expect(onAllow).toHaveBeenCalledWith('https://example.com/p.png');
  });

  it('tags blocks with source positions for scroll sync and selection mapping', () => {
    const { container } = render(<MarkdownPreview markdown={'# Title\n\nPara'} theme="light" />);
    expect(container.querySelector('h1')).toHaveAttribute('data-sl', '1');
    expect(container.querySelector('p')).toHaveAttribute('data-sl', '3');
    expect(container.querySelector('p')).toHaveAttribute('data-so', '9');
  });

  it('hides HTML comments such as TOC markers', () => {
    const { container } = render(
      <MarkdownPreview markdown={'<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->'} theme="light" />,
    );
    expect(container.textContent).not.toContain('toc');
  });
});

describe('panels', () => {
  it('status bar shows counts', () => {
    render(
      <StatusBar
        fileName="a.md"
        saveState="Saved"
        stats={{
          cursorLine: 2,
          cursorColumn: 3,
          selectionCharacters: 4,
          selectionWords: 1,
          words: 10,
          characters: 50,
          lines: 5,
          readingMinutes: 1,
        }}
      />,
    );
    expect(screen.getByRole('contentinfo', { name: 'Document status' })).toHaveTextContent('Ln 2, Col 3');
    expect(screen.getByText('4 selected (1 words)')).toBeInTheDocument();
  });

  it('tab bar supports arrow keys and close buttons', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <TabBar
        documents={[
          { id: '1', fileName: 'a.md' },
          { id: '2', fileName: 'b.md', dirty: true },
        ]}
        activeId="1"
        onSelect={onSelect}
        onClose={onClose}
        onNew={() => {}}
      />,
    );
    screen.getByRole('tab', { name: /a\.md/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenCalledWith('2');
    await user.click(screen.getByRole('button', { name: 'Close b.md' }));
    expect(onClose).toHaveBeenCalledWith('2');
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  });

  it('shortcut reference uses platform labels', () => {
    render(<ShortcutsDialog mac onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveTextContent('⌘⇧P');
  });
});
