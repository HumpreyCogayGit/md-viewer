import { operationFactory } from '../define.js';

// js-beautify is loaded only when a beautify operation runs.
let beautifierPromise;
const loadBeautifier = () => {
  beautifierPromise ||= import('js-beautify').then((module) => module.default || module);
  return beautifierPromise;
};

export function minifyCss(css) {
  const strings = [];
  const protectedCss = String(css).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (match) => {
    strings.push(match);
    return `\u0000${strings.length - 1}\u0000`;
  });
  return (
    protectedCss
      .replace(/\/\*(?!!)[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,>~+])\s*/g, '$1')
      .replace(/;}/g, '}')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      // `calc(1px + 2px)` needs its spaces around + and -.
      .replace(/calc\(([^)]*)\)/g, (match, inner) => `calc(${inner.replace(/([^\s(])([+-])(?=[\d.(])/g, '$1 $2 ')})`)
      .replace(/\u0000(\d+)\u0000/g, (_, index) => strings[Number(index)])
      .trim()
  );
}

/** Conservative HTML minifier: removes comments and inter-tag whitespace; leaves <pre>, <textarea>, <script>, <style> intact. */
export function minifyHtml(html) {
  const preserved = [];
  const protectedHtml = String(html).replace(/<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi, (match) => {
    preserved.push(match);
    // Tag-shaped placeholder so whitespace around preserved blocks collapses like around any tag.
    return `<\u0000${preserved.length - 1}\u0000>`;
  });
  return protectedHtml
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .replace(/<\u0000(\d+)\u0000>/g, (_, index) => preserved[Number(index)])
    .trim();
}

const INDENT_OPTION = { key: 'indent', label: 'Indent', type: 'number', default: 2, min: 1, max: 8 };
const op = operationFactory('Format', { supportsFencedBlock: true });

export const codeOperations = [
  op({
    id: 'format.css-beautify',
    name: 'Beautify CSS',
    description: 'Indent CSS, SCSS and Less.',
    aliases: ['prettify css', 'format css'],
    inputType: 'css',
    outputType: 'css',
    inputLanguages: ['css', 'scss', 'less'],
    options: [INDENT_OPTION],
    run: async (input, { indent }) => (await loadBeautifier()).css(input, { indent_size: indent }),
  }),
  op({
    id: 'format.css-minify',
    name: 'Minify CSS',
    description: 'Remove comments and whitespace from CSS (/*! license */ comments kept).',
    aliases: ['compress css'],
    inputType: 'css',
    outputType: 'css',
    inputLanguages: ['css'],
    run: minifyCss,
  }),
  op({
    id: 'format.html-beautify',
    name: 'Beautify HTML',
    description: 'Indent HTML markup.',
    aliases: ['prettify html', 'format html'],
    inputType: 'html',
    outputType: 'html',
    inputLanguages: ['html', 'htm', 'vue', 'svelte'],
    options: [INDENT_OPTION],
    run: async (input, { indent }) =>
      (await loadBeautifier()).html(input, { indent_size: indent, wrap_line_length: 0 }),
  }),
  op({
    id: 'format.html-minify',
    name: 'Minify HTML',
    description: 'Remove comments and whitespace between tags (pre/script/style untouched).',
    aliases: ['compress html'],
    inputType: 'html',
    outputType: 'html',
    inputLanguages: ['html', 'htm'],
    potentiallyLossy: true,
    lossyWarning: 'Whitespace between inline elements can be significant in HTML.',
    run: minifyHtml,
  }),
  op({
    id: 'format.js-beautify',
    name: 'Beautify JavaScript',
    description: 'Indent JavaScript/JSON-like code with a maintained formatter (loaded on demand).',
    aliases: ['prettify js', 'format javascript', 'unminify'],
    inputType: 'javascript',
    outputType: 'javascript',
    inputLanguages: ['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript'],
    options: [INDENT_OPTION],
    run: async (input, { indent }) => (await loadBeautifier()).js(input, { indent_size: indent }),
  }),
];
