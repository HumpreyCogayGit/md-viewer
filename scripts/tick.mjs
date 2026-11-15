// Usage: node scripts/tick.mjs 1.2 1.3 ...  — marks items done in IMPLEMENTATION_PROGRESS.md
import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../IMPLEMENTATION_PROGRESS.md', import.meta.url);
let text = readFileSync(file, 'utf8');
for (const id of process.argv.slice(2)) {
  const pattern = new RegExp(`^- \\[[ ~]\\] ${id.replace('.', '\\.')} `, 'm');
  if (!pattern.test(text)) {
    console.error(`not found: ${id}`);
    continue;
  }
  text = text.replace(pattern, `- [x] ${id} `);
}
writeFileSync(file, text);
