// One lazily loaded highlighter (highlight.js core + common languages) for every code block in the preview.
// highlight.js escapes its output, so the returned HTML is safe to insert.

let highlighterPromise;

const LANGUAGES = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  go: () => import('highlight.js/lib/languages/go'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  plaintext: () => import('highlight.js/lib/languages/plaintext'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  shell: () => import('highlight.js/lib/languages/shell'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

const ALIASES = {
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  'c++': 'cpp',
  cs: 'csharp',
  kt: 'kotlin',
  html: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  rss: 'xml',
  atom: 'xml',
  wsdl: 'xml',
  xsd: 'xml',
  plist: 'xml',
  yml: 'yaml',
  md: 'markdown',
  ps1: 'powershell',
  toml: 'ini',
  env: 'ini',
  dotenv: 'ini',
  properties: 'ini',
  mysql: 'sql',
  postgresql: 'sql',
  postgres: 'sql',
  pgsql: 'sql',
  sqlite: 'sql',
  plsql: 'sql',
  tsql: 'sql',
  mssql: 'sql',
  jsonc: 'json',
  json5: 'json',
  jsonl: 'json',
  patch: 'diff',
  docker: 'dockerfile',
  text: 'plaintext',
  txt: 'plaintext',
  scss: 'css',
  less: 'css',
};

export const resolveLanguage = (language) => {
  const lower = String(language || '').toLowerCase();
  const name = ALIASES[lower] || lower;
  return LANGUAGES[name] ? name : null;
};

export function loadHighlighter() {
  highlighterPromise ||= import('highlight.js/lib/core').then(async (module) => {
    const hljs = module.default || module;
    const entries = await Promise.all(
      Object.entries(LANGUAGES).map(async ([name, load]) => [name, (await load()).default]),
    );
    for (const [name, definition] of entries) hljs.registerLanguage(name, definition);
    return hljs;
  });
  return highlighterPromise;
}

/** Highlight code. With no language, auto-detect among a small set only when the code is clearly structured. */
export function highlightCode(hljs, code, language) {
  const resolved = resolveLanguage(language);
  if (resolved)
    return { html: hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value, language: resolved };
  if (language) return null;
  const auto = hljs.highlightAuto(code, ['json', 'sql', 'xml', 'yaml', 'bash', 'javascript', 'python']);
  return auto.relevance >= 6 ? { html: auto.value, language: auto.language } : null;
}
