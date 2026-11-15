# Security Policy

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's **private vulnerability reporting** for this repository
(Security tab → "Report a vulnerability"). Do not open a public issue for security problems.

Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal Markdown document or operation input helps),
- the browser and version you used.

You can expect an acknowledgement within 7 days. We will keep you informed while a fix is prepared and credit you in
the release notes unless you prefer otherwise.

## Scope

In scope: cross-site scripting through rendered Markdown, Mermaid or KaTeX; unsafe URL handling; content leaving the
browser without consent; denial of service through crafted input that bypasses the documented size, time and
expansion limits; dependency vulnerabilities that are reachable in Speculo.

Out of scope: issues that need a compromised browser or extensions, and self-XSS that requires pasting attacker code
into developer tools.

## Security design notes

- Text transformations run locally; no operation makes network requests.
- Rendered Markdown does not execute raw HTML; unsafe link schemes are removed; only `data:image/*` URLs are allowed
  for images.
- Mermaid runs with `securityLevel: 'strict'` and its SVG output is sanitized with DOMPurify. Exported HTML is
  sanitized as well.
- Expensive operations run in a Web Worker that is terminated on timeout or cancel. Inputs and outputs have size
  limits, and decompression stops at 50 MB or a 1000× expansion ratio.
- Production deployments send a Content Security Policy (`security-headers.js`).
- Cryptographic operations are provided for convenience and compatibility only. Speculo makes no claim of
  cryptographic correctness; MD5 and SHA-1 are labelled insecure, and JWT decoding does not verify signatures.
- `npm audit --omit=dev` runs in CI, and Dependabot proposes dependency updates.
