# Speculo

A privacy-focused Markdown editor with built-in developer text and data tools. Write Markdown with a live preview
(GFM, KaTeX math, Mermaid diagrams, syntax highlighting) and transform selections with 250+ local operations:
encodings, hashes, timestamps, CSV ↔ JSON ↔ Markdown tables, JSON/XML/YAML/TOML, JWT inspection, table of
contents, and more.

All text transformations run in your browser. See [Privacy](#privacy).

## Features

- **Editor:** live preview with line-based scroll sync, line numbers, find and replace (literal or regex), grouped
  undo/redo that restores the caret, Tab/Shift+Tab indentation, multiple document tabs, outline panel, status bar
  (words, characters, lines, selection, reading time), autosave in this browser, and a warning before closing with
  unsaved changes.
- **Files:** open/save in place with the File System Access API (Chromium) or open/download elsewhere; recent files;
  drag and drop files onto the window; embed images (file, drop or paste) as data URIs; paste rich text as Markdown
  and spreadsheet cells as a table.
- **Export:** PDF (lazy-loaded; asks before downloading remote images), standalone HTML with inlined CSS, copy as rich
  text, print stylesheet.
- **Tools on right-click:** right-click in the editor or preview (or press Shift+F10 / the Menu key) for tools
  suggested for the selection, recent tools, and every tool grouped by category (Format, Convert, Encode, Decode,
  Text, Markdown, Hash, …). Shift+right-click still opens the browser's own menu.
- **Operations:** the **Tools** button or a searchable palette (⌘⇧P / Ctrl+Shift+P) with aliases, favourites, recents, option forms,
  warning badges, and suggestions for the current selection. Operations run on the selection, the code block around
  the cursor, or — after confirmation — the whole document. Lossy operations show a before/after preview; report
  operations (hashes, inspections) open a result panel and never change the document.
- **Workbench:** a scratch area to chain operations into recipes, inspect each step's output, run per line or per
  paragraph, save recipes locally, import/export them as versioned JSON, and share recipe-only links (input is never
  included).

### Supported formats

| Area | Operations (examples) |
| --- | --- |
| Encoding | Base64/Base64URL/Base32/Base58/Ascii85, URL, HTML entities, hex, hexdump, Unicode and string escapes (JS/JSON/Python/C), binary/octal/decimal bytes, quoted-printable, MIME headers, Punycode, ROT13/47, Morse, Braille |
| Text | case styles (camel, snake, kebab, …), trim/collapse whitespace, line endings, tabs ↔ spaces, sort/dedupe/filter/number lines, wrap, split/join, find/replace, set operations, statistics |
| Cleanup | smart quotes → ASCII, invisible characters, ANSI codes, Unicode normalization, diacritics, strip HTML |
| Structured data | JSON ↔ XML ↔ YAML, CSV/TSV ↔ JSON ↔ Markdown tables, TOML, JSON Lines, JSON5/JSONC, query strings, `.env`, Java properties, JSONPath, flatten/unflatten, sort keys, JSON → TypeScript/JSON Schema, MessagePack, CBOR, BSON, Protobuf (schema-less), PHP serialize, Apple plist |
| Formatting | SQL, JSON, XML, YAML (and explicit Repair YAML), TOML, CSS, HTML, JavaScript; validation with line and column |
| Markdown | TOC generate/update, heading shift, slugs, links/images report, broken anchors, duplicate references, inline ↔ reference links, footnote renumbering, front matter, fence normalization, paragraph wrapping, lists and task lists, table tools, MD ↔ HTML, KaTeX/Mermaid validation, document diagnostics |
| Hashing | SHA-256/384/512, HMAC, CRC-32, Adler-32, MD5/SHA-1 (labelled insecure), hash identification |
| Dates | Unix ↔ ISO-8601 with IANA time zones and DST handling, named/custom formats, durations, date differences, FILETIME |
| Developer | JWT decode (signature not verified), UUID v4/v7 and inspection, ObjectID, TOTP/HOTP, number bases, colors, units, file permissions, CIDR, cron, user agents, URL parsing, diff, gzip/deflate, PEM/X.509 inspection, extractors (URLs, emails, IPs, …), regex tester, defang/refang, generators (UUID, password, Lorem Ipsum, QR code) |

Known lossy conversions are documented in the operations themselves and shown as warnings, for example: XML
comments, processing instructions and namespace declarations are dropped and scalars become strings; YAML comments,
anchors and tags are lost; several YAML documents become one array.

## Getting started

Requirements: Node.js 20 or newer.

```sh
npm ci            # install exactly what package-lock.json specifies
npm run dev       # start the dev server at http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve dist/ (with the production security headers)
```

## Quality checks

```sh
npm test          # unit and component tests (Vitest, jsdom)
npm run test:e2e  # browser tests (Playwright/Chromium); run `npm run build` first
npm run lint      # ESLint
npm run format:check
npm run size      # initial JavaScript bundle budget (gzip), after a build
npm run audit     # production dependency audit
npm run check     # lint + format + tests + build + size
```

CI (`.github/workflows/ci.yml`) runs all of these from a clean `npm ci`. Dependabot keeps dependencies current.

## Architecture

```text
src/
  app/          App composition and the welcome document
  components/   palette, dialogs, preview dialog, result panel, workbench, menus, editor pane, panels
  editor/       pure editor logic: history, text editing, shortcuts, storage, scroll sync, targeting
  export/       PDF (lazy pdfmake), standalone HTML, files (File System Access + fallback)
  operations/   operation engine (registry, selection adapter, bytes, limits, recipes, suggestions, worker client)
                and operation modules: encoding/, text/, hashing/, dates/, structuredData/, markdown/, developer/
  preview/      lazy Mermaid, KaTeX and highlight.js; source-position plugin
  privacy/      consent-based analytics
  pwa/          service worker registration
  workers/      Web Worker that runs expensive operations with real cancellation
```

### Adding an operation

1. Add a definition to the relevant module (for example `src/operations/text/index.js`) with `operationFactory`:
   `id`, `name`, `description`, `aliases`, `options` (schema), `run(input, options)` (may be async), plus metadata such
   as `outputMode` (`replace` | `insert` | `report`), `inputType` (`text` | `bytes` | `none` for generators),
   `potentiallyLossy` + `lossyWarning`, `inverse`, `expensive`, `inputScope`.
2. Add tests. `src/operations/catalog.test.js` fails if any registered operation id is not exercised by a test.

The palette, menus, workbench and suggestions pick it up from the registry; no UI code is needed.

## Supported browsers

Current versions of Chrome/Edge (111+), Firefox (113+) and Safari (16.4+). Opening and saving files in place uses the
File System Access API, available in Chromium-based browsers; other browsers open files with a picker and save by
downloading. Compression operations need `CompressionStream` (same versions).

## Privacy

- Document text and operation input are processed locally and are never sent anywhere by Speculo.
- Documents, preferences, saved recipes and recent-file handles are stored only in this browser (localStorage and
  IndexedDB). Clearing site data removes them.
- Fonts are bundled; no request is made to font services.
- Analytics (Google Analytics) are **off** until you allow them in the consent banner or **Menu → Privacy**. When
  enabled, IP anonymization is requested and no document content is sent. Turning it off stops collection.
- Remote resources: images referenced by URL in your Markdown are loaded by the browser from their hosts. Enable
  **View → Block remote images** to load them only on request. PDF export asks before downloading remote images.
- Share links contain only recipes, never your input.
- No operation contacts the network. Any future network-enabled operation must be opt-in and is labelled with a
  network badge.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability. Production builds are served with a Content Security
Policy (`security-headers.js`, applied in `vercel.json` and `vite preview`). Mermaid runs in strict mode and its SVG is
sanitized with DOMPurify; Markdown links with unsafe schemes (such as `javascript:`) are removed.

## License

GPL-3.0 — see [LICENSE](LICENSE). Third-party packages and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Speculo's operations are independent implementations; CyberChef was
used only as product inspiration.
