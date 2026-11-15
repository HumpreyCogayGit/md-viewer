# Upgrade Plan — Implementation Progress

Tracks execution of `upgrade_plan.md`. Check an item only after its code **and** tests are in place
and `npm test` passes. To resume after an interruption: run `npm install && npm test`, then continue
with the first unchecked item. Items marked `[~]` are intentionally deferred, with the reason inline.

## Stage 0 — Foundation (Phase 0 / Release A 1–2, 8)
- [x] 0.1 Remove unused `html2pdf.js` and `jspdf`
- [x] 0.2 Upgrade Mermaid, KaTeX, and other vulnerable deps; `npm audit --omit=dev` has no critical/high
- [x] 0.3 Untrack `node_modules` (keep lockfile); ignore `.DS_Store`; keep `dist` untracked
- [x] 0.4 Quote test glob; adopt a test runner that finds nested tests
- [x] 0.5 Add ESLint + Prettier config and `lint`/`format:check` scripts
- [x] 0.6 Add CI workflow (clean install, lint, test, build, audit, bundle budget)
- [x] 0.7 Add Dependabot config
- [x] 0.8 Add SECURITY.md, PRIVACY section, README (setup/build/test/formats/browsers)
- [x] 0.9 Add favicon (`public/favicon.svg`), fix `/vite.svg` reference
- [x] 0.10 THIRD_PARTY_NOTICES inventory and license review of new deps

## Stage 1 — Operation engine contract (Phase 1 / Release A 6)
- [x] 1.1 Registry normalizes raw definitions (defaults applied even without `defineOperation`)
- [x] 1.2 Async `run`; fenced-block path match → await → splice
- [x] 1.3 `bytes` data type with text↔bytes helpers (UTF-8)
- [x] 1.4 `outputMode`: replace / insert / report
- [x] 1.5 Generators (no input; insert at cursor)
- [x] 1.6 Options schema (boolean/number/select/text) with default resolution + validation
- [x] 1.7 `aliases`/keywords and registry search
- [x] 1.8 Fence detection: `~~~`, longer fences, indented fences, info strings
- [x] 1.9 Input/output size limits and execution deadline helper
- [x] 1.10 Operation/recipe schema version constants

## Stage 2 — Extract & fix existing formatters (Release A 4, 7; Known defects)
- [x] 2.1 SQL module: multi-char operators (`||`, `::`, `->`, `->>`, `:=`, `<=>`, `$n`, `:name`, `@name`)
- [x] 2.2 SQL minify never creates `--` or `/*`
- [x] 2.3 SQL beautify validates plain selection with `isLikelySql`
- [x] 2.4 JSON module: token-based beautify/minify that preserves numbers & duplicate keys
- [x] 2.5 XML module: pure-JS parser (no DOMParser); text-only elements stay on one line; `>` in attributes
- [x] 2.6 JSON/YAML → XML always yields a single root
- [x] 2.7 YAML module: no silent repair; explicit "Repair YAML" operation
- [x] 2.8 Data conversion operations use the pure modules; real converters tested
- [x] 2.9 Beautify/minify registered as operations; 8 duplicated App handlers deleted
- [x] 2.10 Lossy-conversion fixtures and warnings (XML namespaces/comments/mixed, YAML comments/anchors/multi-doc)

## Stage 3 — App defects & editor usability (Release A 5; UI behavior)
- [x] 3.1 Status/toast: type tracked separately; single timer; `role="status"`/`aria-live`
- [x] 3.2 History: timed typing batches, selection stored/restored on undo/redo
- [x] 3.3 Tab/Shift+Tab indent/outdent of multi-line selections; Esc releases focus trap
- [x] 3.4 Shortcuts: ⌘O, ⌘S, ⌘B, ⌘I, ⌘⇧P, ⌘F + shortcut reference dialog; platform-aware labels
- [x] 3.5 Preview selection maps to the selected occurrence, not the first
- [x] 3.6 Mermaid re-renders on theme change; secure mode; lazy-loaded
- [x] 3.7 Inline code no longer runs block detectors (react-markdown 10 `inline` removal)
- [x] 3.8 File open accepts `.md/.MD/.markdown/.txt`; drop file on editor
- [x] 3.9 Empty-selection message no longer prints "undefined"
- [x] 3.10 Autosave + restore; beforeunload warning on unsaved changes
- [x] 3.11 Persist theme/divider/sync/focus; follow `prefers-color-scheme` on first load
- [x] 3.12 Find & replace in editor (literal + regex)
- [x] 3.13 Open/save via File System Access API with download fallback; recent files list
- [x] 3.14 Document outline panel with click-to-jump
- [x] 3.15 Responsive layout (stacked editor/preview on narrow screens)
- [x] 3.16 Status bar: chars, lines, words, selection, reading time
- [x] 3.17 Debounced preview for large documents
- [x] 3.18 Line-based scroll sync
- [x] 3.19 Print stylesheet
- [x] 3.20 Line numbers gutter in editor
- [x] 3.21 CodeMirror 6 evaluated; decision (keep textarea for now) documented in docs/codemirror-evaluation.md
- [x] 3.22 Multiple documents/tabs (tab bar, per-tab history, autosave of all tabs)

## Stage 4 — PDF export (Known defects; Phase 4)
- [x] 4.1 PDF content builder extracted to `src/export/pdf.js` (pure, tested)
- [x] 4.2 Nested lists not duplicated
- [x] 4.3 Paragraph with image keeps surrounding text
- [x] 4.4 Code blocks use a monospace font
- [x] 4.5 Export failures reported
- [x] 4.6 pdfmake lazy-loaded on export; prompt before fetching remote images
- [x] 4.7 Markdown export helpers in `src/export/markdown.js`

## Stage 5 — Operation UX (Release B 1–2)
- [x] 5.1 Operation palette (⌘⇧P): search names/descriptions/categories/aliases, grouped, badges
- [x] 5.2 Keyboard navigation in palette; favourites & recents in localStorage
- [x] 5.3 Option controls rendered from schema
- [x] 5.4 Result panel for report operations (copy / insert)
- [x] 5.5 Preview dialog for lossy operations (original, output, warnings, replace/insert/copy/download/cancel)
- [x] 5.6 Menus generated from the registry
- [x] 5.7 Target: selection / current fenced block / whole document (with confirmation)
- [x] 5.8 Suggestions ("magic"): detect Base64/hex/JWT/URL-encoding/JSON/timestamps → suggest only

## Stage 6 — Tier 1 operations (Release B 3–6)
- [x] 6.1 Base64, Base64URL, Base32 encode/decode (Unicode-safe)
- [x] 6.2 URL percent, HTML entities, Hex, Unicode escape, generic string escapes (JS/JSON/Python/C)
- [x] 6.3 UTF-8 ↔ bytes/binary/octal/decimal/char codes; hexdump to/from
- [x] 6.4 ROT13 / ROT47
- [x] 6.5 Case: upper/lower/title/camel/Pascal/snake/kebab/CONSTANT/swap
- [x] 6.6 Whitespace: trim, collapse, CRLF/LF, tabs↔spaces
- [x] 6.7 Lines: sort, dedupe, reverse, shuffle, prefix/suffix, number add/remove, head/tail, filter, pad, wrap/unwrap, count, split/join
- [x] 6.8 Find/replace literal & regex
- [x] 6.9 JSON string escape/unescape; shell & SQL escaping by dialect
- [x] 6.10 Cleanup: smart chars → ASCII, invisible chars (show/remove), ANSI, Unicode normalization, diacritics, strip HTML
- [x] 6.11 SHA-256/384/512 via Web Crypto (report, one-way note)
- [x] 6.12 Dates: Unix s/ms ↔ ISO, UTC/local, ISO normalization, duration formatting, warnings

## Stage 7 — Tier 2 structured data & tools
- [x] 7.1 CSV/TSV ↔ JSON, CSV ↔ Markdown table, change delimiter (mature parser)
- [x] 7.2 Markdown table formatter/aligner
- [x] 7.3 TOML ↔ JSON, TOML format/validate
- [x] 7.4 Query string / form-urlencoded ↔ JSON (repeat keys, arrays, nested)
- [x] 7.5 `.env` and Java properties ↔ JSON with warnings
- [x] 7.6 Validation: JSON/YAML/XML with line+column; URL validation
- [x] 7.7 JSON ↔ JSON Lines; JSON5/JSONC → JSON
- [x] 7.8 Quoted-printable, MIME encoded-word decode, Punycode/IDN
- [x] 7.9 Set operations on line lists; numeric stats
- [x] 7.10 Extractors: URLs, emails, domains, IPv4/6, MAC, dates, paths, hashes; regex extract
- [x] 7.11 HMAC, CRC-32, Adler-32, all-hashes report
- [x] 7.12 Parsers: URL, file permissions, CIDR/IPv4 formats, cron explain, date delta/add
- [x] 7.13 CSS/HTML/JS beautify & minify; JSON sort keys; JSON → TypeScript / JSON Schema
- [x] 7.14 Generators: UUID v4/v7, random string/password, Lorem Ipsum, timestamp, QR code SVG
- [x] 7.15 Defang / refang

## Stage 8 — Tier 3 Markdown productivity
- [x] 8.1 TOC generate/update; heading slugs; shift headings
- [x] 8.2 Links/images extraction; broken local anchors; duplicate reference definitions
- [x] 8.3 Inline ↔ reference links; sort reference definitions
- [x] 8.4 Front matter extract; JSON/YAML ↔ front matter
- [x] 8.5 Normalize code-fence languages; wrap paragraphs (skip code/tables)
- [x] 8.6 Markdown → plain text; Markdown → HTML; HTML → Markdown
- [x] 8.7 Validate Mermaid blocks; validate KaTeX
- [x] 8.8 Document diagnostics report (headings, links, images, code blocks, reading time)
- [x] 8.9 Lists: bullet ↔ numbered ↔ task, renumber, toggle task
- [x] 8.10 Table tools: sort by column, transpose, add/remove/move column
- [x] 8.11 Escape/unescape Markdown; slugify; renumber footnotes
- [x] 8.12 Paste HTML as Markdown; paste TSV as table; embed image as data URI
- [x] 8.13 Export standalone HTML; copy as rich text

## Stage 9 — Tier 4 advanced
- [x] 9.1 JWT decode/inspect (timestamps; "signature not verified")
- [x] 9.2 UUID validate/format; number base conversion; color HEX/RGB/HSL
- [x] 9.3 Regex tester; JSONPath; JSON flatten/unflatten
- [x] 9.4 Diff two texts
- [x] 9.5 Gzip/deflate (worker-capable, expansion-bomb limit)
- [x] 9.6 PEM / X.509 inspection
- [x] 9.7 Base58/Base85; Morse; Levenshtein; char frequency/entropy
- [x] 9.8 MD5 / SHA-1 (labelled insecure); hash type identification
- [x] 9.9 Unit/data-size conversion; ObjectID/UUID timestamp; FILETIME; user-agent parse
- [x] 9.10 TOTP/HOTP
- [x] 9.11 MessagePack, CBOR, BSON, schema-less Protobuf, PHP serialize, Apple plist (XML + binary)

## Stage 10 — Recipes & workbench (Phase 5)
- [x] 10.1 Recipe engine: ordered steps, enable/disable, options, intermediate outputs
- [x] 10.2 Versioned JSON import/export + migrations; localStorage persistence
- [x] 10.3 Workbench panel (input → recipe → output; send selection / insert output)
- [x] 10.4 Auto-run toggle; per-item (line) mode; I/O statistics
- [x] 10.5 Shareable recipe links (fragment, never input)
- [x] 10.6 Drag/keyboard reorder of steps

## Stage 11 — Performance, privacy, offline (Phase 4)
- [x] 11.1 Web Worker runner for expensive ops, with timeout + cancellation
- [x] 11.2 Mermaid/KaTeX/PDF lazy-loaded; bundle-size budget script
- [x] 11.3 Analytics consent-based
- [x] 11.4 Fonts bundled locally
- [x] 11.5 CSP via `vercel.json` headers
- [x] 11.6 Dangerous URL schemes rejected in preview
- [x] 11.7 PWA manifest + service worker (offline)

## Stage 12 — Accessibility
- [x] 12.1 Editor label; icon-only controls labelled
- [x] 12.2 Keyboard-adjustable divider (`role="separator"`)
- [x] 12.3 Menu: `aria-expanded`, `aria-controls`, roles, arrow keys, Escape, focus return
- [x] 12.4 Button for file selection; visible focus styles; reduced motion

## Stage 13 — Testing
- [x] 13.1 Unit tests for every operation (valid/empty/invalid/Unicode/large/boundary)
- [x] 13.2 Regression tests for every known defect
- [x] 13.3 Component tests (palette, preview, warnings, apply/cancel)
- [x] 13.4 Browser E2E smoke tests (Playwright)

## Notes / decisions log
- 2026-11-15: Test runner switched to Vitest (`vitest run`, glob `src/**/*.test.{js,jsx}` expanded by Vitest, not the shell).
- 2026-11-15: `katex` forced to ^0.19.1 via `overrides` (nested copies in rehype-katex/micromark were vulnerable);
  `glob`/`minimatch` overridden for js-beautify. `npm audit` → 0 vulnerabilities.
- 2026-11-15: Operations may declare `validate` (lenient gate for a plain selection), `detect` (strict, used to
  recognise unlabeled fenced blocks) and `diagnose` (returns a line/column message when validation fails).
- 2026-11-15: Original YAML auto-repair heuristic corrupted valid YAML; replaced by a level-snapping algorithm and
  exposed only as the explicit, previewed "Repair YAML" operation.
- 2026-11-15: App split into src/app, src/components, src/editor, src/preview, src/export, src/privacy, src/pwa,
  src/workers. The 3,000-line src/App.jsx was removed; all eight beautify/minify handlers are registry operations.
- 2026-11-15: Palette Enter runs with defaults unless an option needs input (empty text field); Shift+Enter or ⚙ opens
  options. Search results keep relevance order across categories (found by e2e: "upper case" ran Beautify SQL).
- 2026-11-15: PDF export lazily loads Courier AFM metrics from pdfmake's PDFKit fork; async pdfmake errors are
  captured (previously the export hung silently).
- 2026-11-15: E2E uses plain Chromium (device profiles spoof a Windows UA, breaking ⌘ vs Ctrl shortcut matching).

## Follow-up (2026-11-15): tools presentation
- [x] F.1 Right-click tools menu in editor and preview (suggested, recent, category flyouts, search, workbench, clipboard)
- [x] F.2 Keyboard access: Shift+F10 / Menu key; Shift+right-click keeps the native browser menu
- [x] F.3 Gear icon replaced by a labelled "Tools" button (toolbar and header); gear is no longer used for tools
- [x] F.4 Tools that need input (e.g. Filter Lines) open straight to their option form
- [x] F.5 Tests: menu model (every operation reachable), component keyboard/hover tests, 4 e2e flows
