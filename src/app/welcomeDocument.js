export const WELCOME_DOCUMENT = `# Welcome to Speculo

A privacy-focused Markdown editor with built-in developer text and data tools. Everything below runs locally in your browser.

<!-- toc -->

- [Markdown Showcase](#markdown-showcase)
- [Developer Tools](#developer-tools)

<!-- tocstop -->

---

## Markdown Showcase

This is **bold**, this is *italic*, and this is ***bold and italic***. Inline \`code\` looks like this.

> "Simplicity is the ultimate sophistication." — Leonardo da Vinci

Visit [GitHub](https://github.com) for more.

1. Open a Markdown file (⌘O / Ctrl+O)
2. Edit in the left pane
3. Preview in the right pane
4. Save (⌘S / Ctrl+S) or export to PDF/HTML

- [x] Live preview with scroll sync
- [x] Autosave in this browser
- [ ] Write something great

| Feature          | Status   |
| ---------------- | -------- |
| Live Preview     | ✅ Ready |
| Operation palette| ✅ Ready |
| Workbench        | ✅ Ready |

~~This text is struck through.~~

Inline math: $E = mc^2$, and a block:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

\`\`\`mermaid
graph TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Great!]
    B -- No --> D[Debug]
    D --> B
\`\`\`

## Developer Tools

Select something and press **⌘⇧P / Ctrl+Shift+P** to open the operation palette — 250+ local operations: Base64, URL encoding, hashes, JWT decoding, timestamps, CSV ↔ JSON ↔ Markdown tables, TOC, and more. Speculo suggests operations for what you select.

\`\`\`json
{"name":"Speculo","tools":["encode","convert","hash","format"],"offline":true}
\`\`\`

\`\`\`sql
select id, name from users where active = true order by name
\`\`\`

Try putting the cursor inside a code block above and running *Beautify JSON* or *Beautify SQL*.
`;
