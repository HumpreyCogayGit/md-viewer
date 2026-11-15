// Fails when the JavaScript loaded on startup exceeds the budget (gzip). Run after `vite build`.
// Initial JS = the entry script plus the chunks it statically imports (modulepreload links in index.html).
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB || 450);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html not found. Run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const scripts = new Set(
  [...html.matchAll(/<script[^>]+src="\/?([^"]+\.js)"|<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+\.js)"/g)].map(
    (m) => m[1] || m[2],
  ),
);
let total = 0;
for (const file of scripts) {
  const gz = gzipSync(readFileSync(join(DIST, file))).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(8)} KB  ${file}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(8)} KB  initial JavaScript (gzip), budget ${BUDGET_KB} KB`);
if (total / 1024 > BUDGET_KB) {
  console.error('Bundle budget exceeded.');
  process.exit(1);
}
