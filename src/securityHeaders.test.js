import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from '../security-headers.js';

describe('deployment security headers', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = Object.fromEntries(
    vercel.headers.find((rule) => rule.source === '/(.*)').headers.map((h) => [h.key, h.value]),
  );

  it('vercel.json matches the shared header definition', () => {
    expect(headers).toEqual(SECURITY_HEADERS);
  });

  it('CSP forbids plugins, framing and inline scripts', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });
});
