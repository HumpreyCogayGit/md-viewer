// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu.jsx';

const entries = [
  { type: 'heading', id: 'h', label: 'Suggested for selection' },
  { type: 'item', id: 'op:a', label: 'Base64 Decode', operationId: 'decode.base64', hint: 'Decodes Base64' },
  { type: 'separator', id: 's' },
  {
    type: 'submenu',
    id: 'g:Encode',
    label: 'Encode',
    items: [
      { type: 'item', id: 'op:b', label: 'Base64 Encode', operationId: 'encode.base64' },
      { type: 'item', id: 'op:c', label: 'URL Encode', operationId: 'encode.url' },
    ],
  },
  { type: 'item', id: 'action:copy', label: 'Copy', action: 'copy', disabled: true },
];

describe('ContextMenu', () => {
  it('focuses the first item and runs it with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu entries={entries} x={10} y={10} onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Base64 Decode/ })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'decode.base64' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens submenus with → and closes them with ←, skipping disabled items', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ContextMenu entries={entries} x={10} y={10} onSelect={onSelect} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /Base64 Decode/ })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    const encode = screen.getByRole('menuitem', { name: /Encode/ });
    expect(encode).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Base64 Decode/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowRight}');
    expect(encode).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Base64 Encode' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{ArrowLeft}');
    expect(screen.queryByRole('menu', { name: 'Encode' })).toBeNull();
    expect(encode).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'encode.url' }));
  });

  it('opens a submenu on hover and runs a clicked item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ContextMenu entries={entries} x={10} y={10} onSelect={onSelect} onClose={() => {}} />);
    await user.hover(screen.getByRole('menuitem', { name: /Encode/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Base64 Encode' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'encode.base64' }));
  });

  it('closes on Escape and on outside clicks', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <button type="button">outside</button>
        <ContextMenu entries={entries} x={10} y={10} onSelect={() => {}} onClose={onClose} />
      </>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not run disabled items', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ContextMenu entries={entries} x={10} y={10} onSelect={onSelect} onClose={() => {}} />);
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
