# Speculo Upgrade Plan

## Product direction

Speculo should become a privacy-focused Markdown editor with built-in developer text and data tools. CyberChef is product and interaction inspiration only. Speculo's operation engine and operations must be implemented independently, use project-compatible dependencies, and retain Speculo's Markdown-first workflow.

The goal is not to reproduce every CyberChef capability. The goal is to make common documentation, encoding, structured-data, and Markdown transformations easy, local, composable, and safe.

## Current application baseline

The application currently provides:

- React 19 and Vite 8 client application.
- Live Markdown source and rendered preview.
- GitHub Flavored Markdown through `remark-gfm`.
- KaTeX inline and block mathematics.
- Mermaid diagrams.
- Markdown file loading by picker and drag/drop.
- Markdown download, preview copy, and PDF export.
- Undo/redo, focus modes, resizeable panes, and synchronized scrolling.
- Word and character counts.
- Markdown formatting controls.
- SQL beautification, minification, and highlighting.
- JSON beautification, minification, and highlighting.
- XML beautification, minification, and highlighting.
- YAML beautification and minification.
- JSON, XML, and YAML conversion in all six directions.

## Guiding principles

1. **Markdown first:** New tools should improve writing, documenting, and handling developer examples.
2. **Local by default:** Transformations execute in the browser and do not transmit input.
3. **Explicit network behavior:** Any feature that contacts a remote service must be opt-in and visibly labeled.
4. **Non-destructive:** Invalid input never changes the document. Lossy operations show a warning and should eventually offer a preview.
5. **Small operations:** Each operation does one predictable thing and can be tested independently.
6. **Composable design:** Operation output can later become input to another operation.
7. **Accessible UI:** Every operation is usable by keyboard and assistive technology.
8. **Performance boundaries:** Large or expensive work runs in a worker, supports cancellation, and has limits.
9. **Independent implementation:** Do not copy CyberChef source or branding. Use its broad workflow concepts only as inspiration.

## Architecture plan

### Operation contract

Each operation should declare:

- Stable `id`.
- User-facing `name` and `description`.
- `category`.
- `inputType` and `outputType`.
- Optional configurable `options`.
- Optional input validator.
- Pure `run(input, options)` function where possible.
- Selection and fenced-code-block support.
- Whether the operation can be lossy.
- Whether it needs network access.
- Whether it is expensive and should run in a Web Worker.
- Optional inverse operation.
- Input and output filename extensions where relevant.

Contract gaps found in the 2026-11-15 review (resolve before building the first conversion pack):

- **Async `run`:** Web Crypto hashing, `CompressionStream`, and workers are all asynchronous. `registry.execute` and `executeOperationOnSelection` are synchronous, and the fenced-block path uses `String.replace` with a callback, which cannot await. Make `run` allowed to return a promise and rewrite the fenced-block loop as match → await → splice.
- **Byte data type:** `inputType`/`outputType` need a `bytes` (`Uint8Array`) type next to `text`, with explicit text↔bytes conversion (UTF-8 by default). Without it, chains such as Base64 decode → gunzip, or hex → SHA-256, corrupt binary data.
- **Output mode:** each operation declares a default result action: `replace` (formatters, converters), `insert` (generators), or `report` (hashes, JWT inspection, extractors, statistics: shown in a panel with copy/insert, never replacing the selection).
- **Generators:** operations with no input (UUID, Lorem Ipsum, current timestamp, QR code) must run with an empty selection and insert at the cursor. `handleOperation` currently rejects an empty selection.
- **Options schema:** define option descriptors (`key`, `label`, `type`: boolean/number/select/text, `default`, `choices`) so the palette can render option controls and recipes can serialize them.
- **Aliases/keywords:** add an `aliases` field for palette search ("b64", "prettify", "epoch").
- **No DOM in operations:** `DOMParser` does not exist in Web Workers or in `node --test`. XML operations need a pure-JS parser (for example `fast-xml-parser`) before they can be unit-tested or moved to a worker.

The initial independent implementation lives in `src/operations`:

- `registry.js`: operation definition, registration, lookup, grouping, validation, and execution.
- `selection.js`: adapter for plain selections and Markdown fenced code blocks.
- `dataConversionOperations.js`: metadata wrappers for the existing JSON/XML/YAML converters.
- `index.js`: public operation API.
- `operations.test.js`: framework tests.

### Target structure

```text
src/
  app/
    App.jsx
  components/
    OperationPalette.jsx
    OperationPanel.jsx
    OperationPreview.jsx
    StatusToast.jsx
  editor/
    MarkdownEditor.jsx
    MarkdownPreview.jsx
    useDocumentHistory.js
    useScrollSync.js
  operations/
    index.js
    registry.js
    selection.js
    encoding/
    text/
    hashing/
    dates/
    structuredData/
    markdown/
  export/
    markdown.js
    pdf.js
  workers/
    operationWorker.js
  utils/
```

Extract incrementally. Avoid a single large rewrite.

### Operation user experience

#### Operation palette

- Add a searchable operation palette, opened with Cmd/Ctrl+Shift+P.
- Search names, descriptions, categories, and aliases.
- Group results by category.
- Show a short description and relevant warning badges.
- Retain frequently used operations and recent operations locally.
- Generate menus from the same operation registry; do not hard-code each operation in JSX.

#### Input targeting

Operations can target:

- Editor selection.
- Selection mapped from preview to source.
- Current fenced code block.
- Entire document, only after explicit confirmation.
- A separately loaded file for file-oriented operations.

#### Preview before applying

Potentially lossy operations should display:

- Original input.
- Transformed output.
- Validation errors.
- Lossiness and network warnings.
- Replace selection, insert below, copy, download, and cancel actions.

#### Recipes

After individual operations are stable:

- Build ordered multi-step recipes.
- Drag to reorder and enable/disable steps.
- Configure each step's options.
- Inspect intermediate step output.
- Run recipes against selection, current block, or a file.
- Save recipes in local storage.
- Import/export recipes as versioned JSON.
- Keep user input out of share URLs by default.
- Add operation and recipe schema versions for migrations.

## Conversion and operation backlog

### Tier 1: high-value, low-risk

#### Encoding and decoding

- Base64 encode/decode with correct Unicode handling through `TextEncoder`/`TextDecoder`.
- Base64URL encode/decode.
- URL percent encode/decode.
- HTML entity encode/decode.
- Hex encode/decode.
- Unicode escape/unescape.
- UTF-8 text to/from byte and hex representations.

#### Text manipulation

- Uppercase and lowercase.
- Title case.
- Trim leading/trailing whitespace.
- Normalize repeated whitespace.
- Normalize LF and CRLF line endings.
- Tabs to spaces and spaces to tabs with configurable width.
- Sort lines ascending/descending.
- Deduplicate lines with optional case sensitivity.
- Reverse lines.
- Prefix and suffix each line.
- Literal find/replace.
- Regex find/replace with flags and replacement preview.
- JSON string escape/unescape.
- Explicitly labeled shell and SQL string escaping by dialect.

#### Hashing

- SHA-256.
- SHA-384.
- SHA-512.
- Use Web Crypto.
- Clearly state that hashes are one-way and cannot be decoded.
- Defer MD5 and SHA-1; if added for compatibility, label them cryptographically insecure.

#### Date and time

- Unix seconds to/from ISO-8601.
- Unix milliseconds to/from ISO-8601.
- UTC and local display conversion.
- ISO date normalization.
- Duration formatting.
- Explicit timezone handling and invalid/ambiguous date warnings.

### Tier 2: structured data

#### CSV and tables

- CSV to JSON.
- JSON array to CSV.
- CSV to Markdown table.
- Markdown table to CSV.
- Markdown table formatting and column alignment.
- Use a mature CSV parser that supports quoting, delimiters, embedded commas, and newlines.

#### TOML

- TOML to JSON.
- JSON to TOML.
- TOML format and validation.
- Add only after selecting and reviewing a maintained, license-compatible parser.

#### Query strings and forms

- Query string to JSON.
- JSON to query string.
- Form URL-encoded data to/from JSON.
- Options for repeated keys, arrays, and nested notation.

#### Environment and properties formats

- `.env` to/from JSON.
- Java properties to/from JSON.
- Warn about duplicate keys, comments, interpolation, quoting, ordering, and scalar type loss.

#### Validation

- JSON syntax validation with line and column.
- YAML syntax validation with line and column.
- XML validation with line and column.
- URL validation.
- Optional JSON Schema validation in a later release.

#### Existing conversion quality

Document and test that these transformations may be lossy:

- XML namespaces are not represented explicitly.
- XML comments and processing instructions are discarded.
- Mixed XML content may not round-trip exactly.
- XML scalar values remain strings.
- YAML comments, anchors, aliases, tags, and formatting may be lost.
- Multi-document YAML is represented as an array and can be ambiguous.
- Element/key ordering can change.

Add round-trip fixtures and warnings before advertising lossless conversion.

### Tier 3: Markdown productivity

- Generate a table of contents.
- Update a previously generated table of contents.
- Shift heading levels up/down without invalid levels.
- Generate GitHub-style heading slugs.
- Extract links and images.
- Detect duplicate reference definitions.
- Convert inline links to reference links.
- Inline reference links.
- Sort reference definitions.
- Extract front matter.
- Convert JSON/YAML to and from front matter.
- Format Markdown tables.
- Normalize code fence languages.
- Wrap paragraphs to a configurable width without breaking code blocks or tables.
- Convert Markdown to plain text.
- Markdown to HTML.
- HTML to Markdown using a vetted parser/converter.
- Validate Mermaid blocks.
- Validate KaTeX expressions.
- Show headings, links, images, code blocks, reading time, and document diagnostics.
- Find broken local heading anchors.

### Tier 4: advanced developer tools

- Decode and inspect JWT headers and claims.
- Interpret JWT timestamp claims.
- State clearly that decoding does not verify a JWT signature.
- UUID generation, validation, and format conversion.
- Binary/octal/decimal/hex number conversion.
- HEX/RGB/HSL color conversion.
- Regex tester with match groups.
- JSONPath queries.
- JSON flatten/unflatten.
- Sort object keys.
- Diff two selections or documents.
- Gzip/deflate compression and decompression.
- File checksums.
- PEM and X.509 inspection.

Run compression and untrusted complex parsing in workers with input, output, memory, and time limits.

### Additional operations (added 2026-11-15 after reviewing the CyberChef operation catalog)

Names describe behavior only; implement each independently. Suggested tier in brackets.

#### Encoding and data formats

- [T1] Base32 encode/decode; Base58 and Base85 [T4].
- [T1] Text to/from binary, octal, decimal, and character codes.
- [T1] To/from hexdump (offset, hex, ASCII columns) for documenting binary data.
- [T1] Generic string escape/unescape (`\n`, `\t`, `\xNN`, `\uNNNN`) for JS, JSON, Python, and C styles.
- [T1] ROT13 and ROT47.
- [T2] Quoted-printable encode/decode and MIME encoded-word decoding (pasted email content).
- [T2] Punycode / IDN domain conversion.
- [T2] JSON ↔ JSON Lines; JSON5/JSONC (comments, trailing commas) → strict JSON.
- [T2] TSV and other delimiters alongside CSV; change delimiter.
- [T4] MessagePack, CBOR, and BSON to/from JSON; Protobuf decode without schema.
- [T4] PHP serialize/deserialize; Apple property list to JSON.
- [T4] Morse code and Braille (low priority, fun).

#### Text cleanup (high value for pasted content)

- [T1] Smart characters to ASCII: curly quotes, en/em dashes, ellipsis, non-breaking spaces (text pasted from Word or Google Docs).
- [T1] Remove zero-width and invisible characters; show them before removing.
- [T1] Remove ANSI escape codes (pasted terminal output).
- [T1] Unicode normalization (NFC, NFD, NFKC, NFKD) and remove diacritics.
- [T1] Case conversion for identifiers: camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, swap case.
- [T1] Add/remove line numbers.
- [T1] Head and tail (first/last N lines); filter lines by text or regex (keep or drop).
- [T1] Shuffle lines; count occurrences; pad lines; wrap/unwrap at width.
- [T1] Split and join with configurable delimiters (comma list ↔ one item per line).
- [T1] Strip HTML tags; HTML to plain text.
- [T2] Set operations on two line lists: union, intersection, difference, symmetric difference.
- [T2] Sum, mean, median, min, and max of a list of numbers.
- [T4] Levenshtein distance between two selections; character frequency and entropy.

#### Extractors (output as a Markdown list or table)

- [T2] Extract URLs, email addresses, domains, IPv4/IPv6 addresses, MAC addresses, dates, file paths, and hash-like strings, with sort and deduplicate options.
- [T2] Regex extract: all matches or one capture group, one per line.
- [T4] XPath and CSS selector queries on XML/HTML; jq-style or JSONata queries on JSON.

#### Hashing and checksums

- [T2] HMAC (SHA-256/384/512) through Web Crypto.
- [T2] CRC-32 and Adler-32 checksums.
- [T2] "All hashes" report for one input.
- [T4] MD5 and SHA-1 for compatibility only, labeled insecure; identify a hash type from its length and alphabet.

#### Parsers and inspectors (report-style output)

- [T2] Parse a URL into scheme, host, port, path, query table, and fragment.
- [T2] Unix file permissions: octal ↔ symbolic ↔ description.
- [T2] CIDR/IP range calculator; IPv4 format conversion (dotted, decimal, hex).
- [T2] Cron expression explanation (not in CyberChef; common documentation need).
- [T2] Date format translation between named and custom formats; delta between two dates; add/subtract a duration.
- [T4] User-agent parsing; MongoDB ObjectID and UUID timestamp/version analysis; Windows FILETIME conversion.
- [T4] Data-size and other unit conversions.

#### Code formatting

- [T2] CSS beautify/minify.
- [T2] HTML beautify/minify.
- [T2] JavaScript beautify (use a maintained formatter, lazy-loaded; no hand-written JS parser).
- [T2] JSON sort keys; JSON → TypeScript interface or JSON Schema sketch.
- [T2] Syntax highlighting for more languages in the preview through one lazy-loaded highlighter, replacing the hand-written SQL/JSON/XML tokenizers over time.

#### Generators (insert at cursor)

- [T2] UUID v4/v7, random string/password with Web Crypto randomness, Lorem Ipsum, current timestamp in a chosen format.
- [T2] QR code from the selection, inserted as an inline SVG or data-URI image.
- [T4] TOTP/HOTP code generation.

#### Security writing

- [T2] Defang/refang URLs and IP addresses (`hxxp://`, `[.]`) for incident reports written in Markdown.

#### Markdown-specific additions

- [T3] Paste HTML as Markdown (rich-text paste from browsers and office tools).
- [T3] Paste spreadsheet cells (TSV) as a Markdown table.
- [T3] Table tools: sort by column, add/remove/move column, transpose, align.
- [T3] Convert bullet ↔ numbered ↔ task lists; renumber ordered lists; toggle task state.
- [T3] Escape/unescape Markdown special characters.
- [T3] Embed a local image as a data URI; paste an image from the clipboard.
- [T3] Renumber footnotes; slugify selection.
- [T3] Export standalone HTML (inlined CSS) and copy as rich text/HTML.

#### Workflow concepts worth adopting

- **Workbench panel:** a separate input → recipe → output scratch area that does not touch the document. "Send selection to workbench" and "Insert output into document" connect it to the editor. This is where report-style operations, file inputs, and recipes live.
- **Auto-run:** re-run the recipe as the input or options change, with a toggle for expensive recipes.
- **Per-item mode ("fork"):** apply an operation to each line, each table cell, or each regex match instead of the whole input.
- **Favourites and recents** pinned at the top of the palette.
- **Input/output statistics:** length, lines, and byte size beside each pane.
- **Shareable recipe links:** recipe only in the URL fragment; input never included by default (already a stated principle).
- **Suggestions ("magic"):** detect Base64, hex, JWT, URL-encoding, JSON, Unix timestamps in the selection and offer the matching operation.

### Deferred features

- Image manipulation, OCR, and media operations.
- Network protocol and packet parsing; TLS/SSH fingerprinting.
- Disassembly, file carving, YARA, and other forensics.
- Classical and machine ciphers beyond ROT13/ROT47.
- General encryption/decryption suites.
- Password cracking.
- HTTP requests and arbitrary network operations.
- DNS lookups.
- Certificate-chain verification.
- Executable code evaluation.
- Very large binary analysis.
- Automatic transformations that modify source without confirmation.
- Automatic "magic" should initially suggest operations, never silently execute them.

## Known defects in the current implementation (reviewed 2026-11-15)

Fix these before or while extracting operations; each should get a regression test.

### Wrong output

- **SQL beautify splits multi-character operators.** `a || b` becomes `a | | b`, `c::int` becomes `c : : int`, `d->>'x'` becomes `d - > > 'x'`, `$1` becomes `$ 1`, `:name` becomes `: name`. The tokenizer needs `||`, `::`, `->`, `->>`, `:=`, `<=>`, `$n`, `:name`, and `@name` tokens.
- **SQL minify can create a comment.** `1 - -1` becomes `1--1`, which comments out the rest of the line. Keep a space when two operator tokens would join into `--` or `/*`.
- **SQL beautify runs on any text.** A plain selection is not checked with `isLikelySql`, so prose is rewritten ("This is in all cases the end" → `This IS IN ALL cases the` / `END of it`). `handleBeautifySql` also has no `try/catch`.
- **JSON/YAML → XML can emit invalid XML.** A root array (`[1,2]`) or a single key holding an array (`{"items":[…]}`) produces several root elements. Wrap these in one root element.
- **JSON beautify/minify changes numbers.** `JSON.parse` round-trips `12345678901234567890` to `12345678901234567000` and `1.0` to `1`, and drops duplicate keys. Use a token-based formatter that never re-serializes values, or warn.
- **XML beautify moves text onto its own line.** `<name>John</name>` becomes three lines, which changes whitespace-sensitive content; `>` inside an attribute value breaks the tag regex. Keep text-only elements on one line.
- **YAML auto-repair guesses indentation.** `repairCommonYamlIndentation` silently restructures invalid YAML, which conflicts with the "invalid input never changes the document" principle. Make it an explicit "Repair YAML" operation with a preview.
- **Preview selection edits the first match, not the selected one.** `findInSource` uses `indexOf`, so when the selected text appears more than once, the operation is applied to the first occurrence in the document.

### PDF export

- Nested lists are printed twice: `item.text` already contains the nested list text and the nested list is then added again.
- A paragraph that contains an image exports only the image; the surrounding text is dropped.
- Code blocks use Roboto, not a monospace font.
- A failed export is not reported (`try/finally` without `catch`).

### UI behavior

- Advertised shortcuts are not implemented: ⌘O, ⌘S, ⌘B, ⌘I appear in the menu and tooltips but no key handler exists for them.
- Error toasts are styled as success unless the text contains "Failed" or "Only"; "Invalid JSON…" shows as a green success toast. Track status type separately from the message.
- Toast timers overlap: an earlier `setTimeout` clears a later message.
- Undo/redo moves the caret to the end of the document and records one history entry per keystroke (200 keystrokes total). Group typing into timed batches and store/restore the selection.
- Tab always inserts four spaces, replaces a multi-line selection instead of indenting it, has no Shift+Tab, and traps keyboard focus in the editor.
- Toggling the theme does not re-render existing Mermaid diagrams (the effect depends only on the diagram text).
- `inline` no longer exists in react-markdown 10, so `!inline` is always true: inline code is run through the SQL/JSON/XML detectors (including `JSON.parse` and `DOMParser`) on every render and can be highlighted as a block language.
- File open accepts only names ending in lowercase `.md`; `.MD`, `.markdown`, and `.txt` are rejected.
- The drop zone exists only inside the open hamburger menu; a file cannot be dropped on the editor.
- `index.html` references `/vite.svg`, but there is no `public/` directory, so the favicon request fails.
- `handleOperation` builds its empty-selection message from `DATA_FORMAT_LABELS[operation.inputType]`, which prints "undefined" for any non-JSON/XML/YAML operation.

### Operation framework

- `createOperationRegistry` accepts raw objects that skipped `defineOperation`, so defaults (`supportsSelection`, `options`) can be missing; `supportsSelection: undefined` then throws "cannot run on an editor selection". Normalize inside the registry.
- `potentiallyLossy` is set but never shown to the user.
- Fence detection handles only three-backtick fences with a bare language word; `~~~` fences, longer fences, indented fences, and info strings such as ```` ```json title="x" ```` are not recognized.
- The real converters are untested: `operations.test.js` exercises the registry with fake converters only, because the real ones live in `App.jsx` and need `DOMParser`.
- `npm test` uses an unquoted glob (`src/**/*.test.js`). The shell expands `**` as a single level, so tests in the planned nested folders (`operations/encoding/…`) will be silently skipped. Quote the glob so Node expands it.
- Eight beautify/minify handlers (about 480 lines) repeat the same selection logic that `handleOperation` already implements; register them as operations and delete the handlers.

## Editor usability backlog (added 2026-11-15)

These are not conversions, but they affect daily use more than any single operation.

- **Autosave to local storage** and restore on load; warn before unload with unsaved changes. A page refresh currently discards the document.
- Persist theme, divider position, sync-scroll, and focus mode; follow `prefers-color-scheme` on first load.
- Implement the advertised shortcuts and add a shortcut reference.
- Find and replace in the editor (literal and regex).
- Open/save in place with the File System Access API where available; fall back to download.
- Multiple documents or tabs, plus a recent-files list.
- Document outline panel with click-to-jump.
- Responsive layout for narrow screens (the stylesheet has no media queries): stacked or tabbed editor/preview.
- Line numbers and editor syntax highlighting. Evaluate replacing the `<textarea>` with CodeMirror 6, which also provides grouped undo, indent/outdent, search, and multi-cursor, and would remove the custom history code.
- Debounce preview rendering for large documents.
- Line-based scroll sync (map source lines to rendered blocks) instead of ratio-based.
- Character, line, selection, and reading-time counts in a status bar.
- Print stylesheet as a lightweight alternative to PDF export.

## Security and privacy plan

### Immediate dependency work

The November 2026 `npm audit --omit=dev` review found 10 production dependency vulnerabilities, including 2 critical findings, through PDF, Mermaid, DOMPurify, KaTeX, and related dependency paths.

- Remove `html2pdf.js` and `jspdf` first: nothing in `src/` imports either one (PDF export uses `pdfmake`, `marked`, and `html2canvas`). Both critical advisories (html2pdf.js XSS, jsPDF path traversal) come from these two unused packages.
- Upgrade Mermaid to a patched release and regression-test all supported diagrams.
- Review and upgrade KaTeX and the remark/rehype integration together.
- Upgrade, replace, or remove vulnerable PDF dependency paths.
- Run `npm audit --omit=dev` in CI.
- Add automated dependency update tooling.
- Add a security policy and private vulnerability reporting instructions.
- Do not claim cryptographic correctness for future cryptographic operations.

### Untrusted input

- Configure Mermaid with an explicit secure mode.
- Treat generated HTML and SVG as untrusted.
- Avoid `dangerouslySetInnerHTML` unless output is trusted or sanitized with a patched sanitizer.
- Add Content Security Policy headers where deployment allows.
- Reject or safely handle dangerous URL schemes.
- Cap input and output sizes.
- Add execution deadlines and cancellation for expensive operations.
- Protect decompression operations from expansion bombs.
- Avoid running user-provided JavaScript.

### Privacy model

Current transformations run client-side, but the application makes or can make external requests through:

- Google Analytics.
- Google Fonts.
- Remote images in Markdown.
- Remote image fetching during PDF export.

Actions:

- State precisely that text transformations are local rather than claiming the whole app is offline.
- Make analytics consent-based or remove it.
- Bundle fonts locally for an offline/private build.
- Prompt before fetching remote resources for export.
- Display a network badge on any future network-enabled operation.
- Provide an offline build or PWA only after all required assets are local.
- Never include sensitive operation input in shareable URLs by default.

## Performance plan

The reviewed production build succeeds but generates a main JavaScript chunk of approximately 2.96 MB minified and 1.27 MB gzip.

- Dynamically import PDF generation only when exporting.
- Load Mermaid when a document contains a Mermaid block.
- Consider loading KaTeX only when math is present.
- Remove unused direct dependencies after confirming runtime use.
- Review the need for `html2pdf.js`, direct `jspdf`, `html2canvas`, and `pdfmake`; avoid parallel PDF stacks.
- Move expensive operations to Web Workers.
- Add operation progress and cancellation.
- Virtualize or debounce expensive previews for very large documents.
- Establish bundle-size budgets in CI.

Targets:

- Initial JavaScript around 300–500 KB gzip or lower.
- Editor usable before optional PDF and diagram modules load.
- Large transformations do not freeze the editor UI.
- Expensive operations can be canceled.

## Accessibility plan

- Add an accessible label to the Markdown source editor.
- Make the divider keyboard adjustable with `role="separator"` and relevant ARIA values.
- Add `aria-label` to icon-only controls.
- Add `aria-expanded`, `aria-controls`, menu roles, Escape behavior, and focus return.
- Support arrow-key navigation in menus and the operation palette.
- Use a button for file selection rather than a clickable `div`.
- Announce operation success and errors through `aria-live`/`role="status"`.
- Add visible focus styles.
- Display platform-aware Cmd/Ctrl shortcuts.
- Respect reduced-motion preferences.
- Test keyboard-only workflows and common screen readers.

## Repository and engineering quality

### Repository cleanup

- Remove the approximately 1,739 already tracked `node_modules` files from the Git index while retaining `package-lock.json`.
- Add `.DS_Store` to `.gitignore` and remove local artifacts from commits.
- Keep generated `dist` output untracked.
- Add a README with setup, build, test, privacy, and supported-format documentation.

### Testing

- Unit-test every pure operation.
- Test valid, empty, invalid, Unicode, large, and boundary inputs.
- Add expected-output fixtures.
- Add round-trip tests only where lossless behavior is promised.
- Test fenced-block transformation and unrelated-block preservation.
- Test operation registry metadata and duplicate ID rejection.
- Add component tests for operation selection, preview, warnings, and apply/cancel.
- Add browser tests for opening a file, converting a selection, undoing, downloading, PDF export, and keyboard navigation.
- Add browser tests for recipes when recipes are introduced.

### CI checks

- Clean install from lockfile.
- Unit and component tests.
- Production build.
- Lint and formatting checks.
- Dependency audit.
- Bundle-size budget.
- Optional accessibility checks and end-to-end smoke tests.

## Phased roadmap

### Phase 0: stabilize the foundation

Tasks:

- Resolve vulnerable dependencies.
- Remove tracked `node_modules` and `.DS_Store`.
- Add linting and formatting.
- Add unit tests and CI.
- Add security and privacy documentation.
- Confirm supported browsers.
- Remove unused dependencies.
- Document lossy conversions.

Exit criteria:

- Clean checkout installs from `package-lock.json`.
- Build and tests pass in CI.
- No known critical production dependency vulnerabilities.
- No `node_modules` files are tracked.

### Phase 1: extract the operation engine

Tasks:

- Create the independent operation registry and selection adapter.
- Register existing JSON/XML/YAML conversions.
- Render conversion menus from registry metadata.
- Extract beautify/minify operations.
- Centralize operation errors and notifications.
- Add preview/apply/copy behavior.
- Expand operation tests and fixtures.

Exit criteria:

- A basic operation needs one module, tests, and a registry export.
- Adding an operation does not require a dedicated App handler and menu block.
- Existing conversion behavior remains available.

### Phase 2: first conversion pack

Implement:

- Base64 and Base64URL.
- URL encoding.
- HTML entities.
- Hex and Unicode escapes.
- SHA-256/384/512.
- Timestamp conversion.
- Text cleanup and line operations.
- CSV to/from JSON.
- CSV to/from Markdown tables.
- Markdown table formatter.
- Query string to/from JSON.

Exit criteria:

- Every operation has tests.
- Unicode behavior is tested.
- Invalid input is non-destructive.
- Potentially lossy operations show warnings.

### Phase 3: Markdown productivity

- Table of contents generation/update.
- Heading shifting and slug generation.
- Link extraction and local-anchor checking.
- Front matter operations.
- HTML/Markdown conversion.
- Paragraph wrapping.
- Code-fence normalization.
- Document outline and diagnostics.
- Better syntax highlighting.

### Phase 4: performance and offline support

- Lazy-load PDF, Mermaid, and KaTeX features.
- Remove redundant PDF libraries.
- Introduce workers, limits, cancellation, and progress.
- Bundle fonts and assets locally.
- Audit all network requests.
- Make analytics consent-based or remove it.
- Add optional PWA/offline packaging.

### Phase 5: recipes and advanced tools

- Recipe builder and intermediate output inspection.
- Local persistence and versioned import/export.
- TOML and environment formats.
- JWT inspection.
- Compression.
- File checksums.
- Optional format detection and safe suggestions.

## Phase status (2026-11-15, after implementation)

All phases (0–5) and both recommended releases are implemented. Item-by-item status, decisions and the restart
procedure are tracked in `IMPLEMENTATION_PROGRESS.md`.

- Phase 0: done. `node_modules` untracked, `.DS_Store` ignored, 0 production advisories, ESLint + Prettier, CI,
  Dependabot, README/SECURITY/THIRD_PARTY_NOTICES.
- Phase 1: done. Async operation contract (bytes, output modes, generators, options schema, aliases, limits), robust
  fence parsing, all formatters and converters as registry operations, App handlers removed.
- Phase 2–3: done. Tier 1–3 operations with unit tests; known defects fixed with regression tests.
- Phase 4: done. Lazy PDF/Mermaid/KaTeX/highlighter, initial JS ≈307 KB gzip (was 1.27 MB), worker runner with
  cancellation, local fonts, consent-based analytics, CSP, PWA.
- Phase 5: done. Workbench with recipes (versioned JSON, local library, share links), Tier 4 tools, suggestions.
- Testing: 337 unit/component tests (Vitest) and 21 browser tests (Playwright).

## Recommended next release scope

The earlier 15-item scope combined foundation work, two new UI surfaces, and ten operations. Split it into two releases.

### Release A: safe and correct

1. Remove unused `html2pdf.js` and `jspdf`; upgrade Mermaid and KaTeX.
2. Untrack `node_modules`; ignore `.DS_Store`.
3. Lazy-load `pdfmake` (on export) and Mermaid (when a diagram is present). This is a small change and the largest user-visible win, so it moves up from Phase 4.
4. Fix the defects listed under "Known defects", starting with wrong-output items.
5. Autosave and restore; implement advertised shortcuts.
6. Resolve the contract gaps (async, bytes, output mode, generators, options schema).
7. Move beautify/minify into the registry; delete the duplicated handlers.
8. Test the real converters; quote the test glob; add CI.

### Release B: first conversion pack

1. Searchable operation palette with option controls.
2. Result panel for report-style operations; preview for lossy ones.
3. Base64/Base64URL, URL encoding, HTML entities, hex, Unicode and string escapes.
4. Text cleanup: case conversions, sort/dedupe/filter lines, smart-character and invisible-character cleanup, strip ANSI.
5. SHA-256/384/512.
6. Timestamp conversion.
7. CSV/TSV to/from JSON and Markdown tables; paste spreadsheet as table.
8. Generate/update Markdown table of contents.

## Licensing and attribution

CyberChef is Apache License 2.0 and Crown Copyright. Speculo currently carries a GPLv3 license file.

- Independently implement operation search, pipelines, recipes, and step inspection.
- Do not copy CyberChef source merely to accelerate implementation.
- Do not use CyberChef or GCHQ names, marks, or visual identity as Speculo branding.
- If source is ever copied or adapted, preserve required copyright, Apache 2.0, and applicable NOTICE material; identify modifications and review compatibility with Speculo's GPLv3 distribution obligations.
- Review every new dependency's license before adoption.
- Keep a third-party notices inventory for distributed builds.

## Success metrics

- Time required to add and test a new operation.
- Operation success/error rate without document corruption.
- Initial bundle size and time to interactive.
- Editor responsiveness on large documents.
- Percentage of operations with complete tests and documentation.
- Keyboard and screen-reader completion of primary workflows.
- No critical production dependency vulnerabilities.
- Use of Markdown-specific operations and saved recipes.