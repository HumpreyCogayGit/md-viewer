import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import mermaid from 'mermaid';
import html2canvas from 'html2canvas';
import { marked } from 'marked';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import './App.css';

// #18: Safe vfs assignment for pdfmake v0.2+
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

// Initialize mermaid with default config
mermaid.initialize({ startOnLoad: false, theme: 'dark' });

// Helper: render SVG string to a base64 PNG data URL via canvas
// targetWidth constrains the output; scale (default 2) renders at higher res for sharpness
function svgToDataUrl(svgString, targetWidth = 400, scale = 2) {
  return new Promise((resolve, reject) => {
    // Parse SVG to read native dimensions and force a target width
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = svgDoc.querySelector('svg');
    if (!svgEl) return reject(new Error('Invalid SVG'));

    // Read native size from the SVG's width/height or viewBox
    let nativeW = parseFloat(svgEl.getAttribute('width')) || 400;
    let nativeH = parseFloat(svgEl.getAttribute('height')) || 300;
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      if (parts.length === 4) { nativeW = parts[2]; nativeH = parts[3]; }
    }

    const ratio = nativeH / nativeW;
    const drawW = targetWidth;
    const drawH = targetWidth * ratio;

    // Set explicit dimensions on the SVG element
    svgEl.setAttribute('width', String(drawW));
    svgEl.setAttribute('height', String(drawH));
    if (!vb) svgEl.setAttribute('viewBox', `0 0 ${nativeW} ${nativeH}`);

    const serialized = new XMLSerializer().serializeToString(svgEl);
    const svgData = 'data:image/svg+xml;base64,' + btoa(encodeURIComponent(serialized).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = drawW * scale;
      canvas.height = drawH * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = svgData;
  });
}

// Helper: fetch a remote image URL and return a base64 data URL
function imageUrlToDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

// Helper: render a KaTeX expression to a base64 PNG data URL
async function katexToDataUrl(expression, displayMode = true) {
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;background:#fff;padding:16px;';
  container.innerHTML = katex.renderToString(expression, {
    displayMode,
    throwOnError: false,
    output: 'html',
  });
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { backgroundColor: '#ffffff', scale: 2 });
    return canvas.toDataURL('image/png');
  } finally {
    document.body.removeChild(container);
  }
}

// Mermaid diagram component for ReactMarkdown code blocks
function MermaidDiagram({ children }) {
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const code = String(children).trim();
    const id = `mermaid-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    let cancelled = false;
    mermaid.render(id, code).then(({ svg }) => {
      if (!cancelled) setSvg(svg);
    }).catch((err) => {
      if (!cancelled) setError(err.message || 'Invalid Mermaid syntax');
    });
    return () => { cancelled = true; };
  }, [children]);

  if (error) return <pre className="mermaid-error">{error}</pre>;
  return <div className="mermaid-diagram" ref={containerRef} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const SQL_KEYWORDS = new Set([
  'ADD', 'ALL', 'ALTER', 'AND', 'AS', 'ASC', 'BEGIN', 'BETWEEN', 'BY', 'CASE', 'CHECK', 'COLUMN',
  'COMMIT', 'CONSTRAINT', 'CREATE', 'CROSS', 'DATABASE', 'DEFAULT', 'DELETE', 'DESC', 'DISTINCT',
  'DROP', 'ELSE', 'END', 'EXISTS', 'FALSE', 'FOREIGN', 'FROM', 'FULL', 'GROUP', 'HAVING', 'IN',
  'INNER', 'INSERT', 'INTO', 'IS', 'JOIN', 'KEY', 'LEFT', 'LIKE', 'LIMIT', 'NOT', 'NULL', 'OFFSET',
  'ON', 'OR', 'ORDER', 'OUTER', 'PRIMARY', 'REFERENCES', 'RETURNING', 'RIGHT', 'ROLLBACK', 'SELECT',
  'SET', 'TABLE', 'THEN', 'TRUE', 'UNION', 'UNIQUE', 'UPDATE', 'VALUES', 'VIEW', 'WHEN', 'WHERE',
  'WITH'
]);

const SQL_FUNCTIONS = new Set([
  'AVG', 'COALESCE', 'COUNT', 'DATE', 'IFNULL', 'LOWER', 'MAX', 'MIN', 'NOW', 'ROUND', 'SUM', 'UPPER'
]);

const SQL_CLAUSE_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'UNION', 'UNION ALL',
  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE', 'ALTER', 'DROP', 'VALUES', 'SET', 'RETURNING',
  'JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'RIGHT JOIN', 'RIGHT OUTER JOIN', 'INNER JOIN', 'FULL JOIN',
  'FULL OUTER JOIN', 'CROSS JOIN', 'ON', 'WITH'
]);

const SQL_LINE_BREAK_KEYWORDS = new Set(['AND', 'OR', 'WHEN', 'ELSE']);

// Use spaces instead of literal tab characters for SQL formatting.
// Safari can render textarea/code tabs inconsistently, especially while text is selected.
// Four spaces gives deterministic visual indentation across browsers and exports.
const SQL_INDENT = '    ';

function tokenizeSql(code) {
  const regex = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_][\w$]*|[(),.;]|<>|!=|<=|>=|==|[+\-*/%=<>]|\s+|.)/g;
  return Array.from(code.matchAll(regex), ([, value]) => {
    if (/^\s+$/.test(value)) return { type: 'space', value };
    if (/^(--|\/\*)/.test(value)) return { type: 'comment', value };
    if (/^['"`]/.test(value)) return { type: 'string', value };
    if (/^\d/.test(value)) return { type: 'number', value };
    if (/^[A-Za-z_]/.test(value)) {
      const upper = value.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) return { type: 'keyword', value: upper };
      if (SQL_FUNCTIONS.has(upper)) return { type: 'function', value: upper };
      return { type: 'identifier', value };
    }
    if (/^[(),.;]$/.test(value)) return { type: 'punctuation', value };
    if (/^(<>|!=|<=|>=|==|[+\-*/%=<>])$/.test(value)) return { type: 'operator', value };
    return { type: 'plain', value };
  });
}

function formatSql(sql) {
  const tokens = tokenizeSql(sql.trim()).filter((token) => token.type !== 'space');
  if (tokens.length === 0) return '';

  const lines = [];
  let indentLevel = 0;
  let contentIndent = 0;
  let skipCount = 0;
  const parenStack = [];

  const tokenValue = (token) => (
    token.type === 'keyword' || token.type === 'function'
      ? token.value.toUpperCase()
      : token.value
  );

  const getClause = (index) => {
    const first = tokenValue(tokens[index]);
    const second = tokens[index + 1] ? tokenValue(tokens[index + 1]) : '';
    const third = tokens[index + 2] ? tokenValue(tokens[index + 2]) : '';

    const threeWord = `${first} ${second} ${third}`;
    const twoWord = `${first} ${second}`;

    if (SQL_CLAUSE_KEYWORDS.has(threeWord)) return { value: threeWord, consumed: 3 };
    if (SQL_CLAUSE_KEYWORDS.has(twoWord)) return { value: twoWord, consumed: 2 };
    if (SQL_CLAUSE_KEYWORDS.has(first)) return { value: first, consumed: 1 };
    return null;
  };

  const currentLine = () => lines[lines.length - 1] || '';
  const setCurrentLine = (value) => {
    if (lines.length === 0) lines.push(value);
    else lines[lines.length - 1] = value;
  };
  const newLine = (indent = contentIndent) => {
    if (lines.length > 0) setCurrentLine(currentLine().trimEnd());
    lines.push(SQL_INDENT.repeat(Math.max(indent, 0)));
  };
  const append = (value, { noLeadingSpace = false } = {}) => {
    if (lines.length === 0) newLine(0);
    const line = currentLine();
    const hasContent = line.trim().length > 0;
    const baseLine = hasContent ? line.trimEnd() : line;
    const lastChar = baseLine.slice(-1);
    const needsSpace = hasContent && !noLeadingSpace && !/[\s(.]/.test(lastChar) && !/^[),.;]$/.test(value);
    setCurrentLine(baseLine + (needsSpace ? ' ' : '') + value);
  };
  const hasOpenExpressionParen = () => parenStack.some((entry) => entry === 'expr');
  const clauseLineIndent = (clause) => (
    clause === 'ON' ? indentLevel + 1 : indentLevel
  );
  const clauseContentIndent = (clause, lineIndent) => {
    if (clause.startsWith('UNION')) return lineIndent;
    return lineIndent + 1;
  };

  tokens.forEach((token, index) => {
    if (skipCount > 0) {
      skipCount -= 1;
      return;
    }

    const value = tokenValue(token);
    const nextValue = tokens[index + 1] ? tokenValue(tokens[index + 1]) : '';

    if (token.type === 'comment') {
      if (currentLine().trim() !== '') newLine();
      append(value, { noLeadingSpace: true });
      newLine();
      return;
    }

    if (value === '(') {
      const startsSubquery = nextValue === 'SELECT' || nextValue === 'WITH';
      append(value, { noLeadingSpace: true });

      if (startsSubquery) {
        parenStack.push('subquery');
        indentLevel += 1;
        contentIndent = indentLevel;
        newLine(indentLevel);
      } else {
        parenStack.push('expr');
      }
      return;
    }

    if (value === ')') {
      const parenType = parenStack.pop();
      if (parenType === 'subquery') {
        indentLevel = Math.max(indentLevel - 1, 0);
        contentIndent = indentLevel + 1;
        if (currentLine().trim() !== '') newLine(indentLevel);
      }
      append(value, { noLeadingSpace: true });
      return;
    }

    if (value === ',') {
      append(value, { noLeadingSpace: true });
      if (!hasOpenExpressionParen()) {
        newLine(contentIndent);
      }
      return;
    }

    if (value === ';') {
      append(value, { noLeadingSpace: true });
      contentIndent = 0;
      indentLevel = 0;
      newLine(0);
      return;
    }

    if (token.type === 'keyword') {
      if (value === 'CASE') {
        if (currentLine().trim() !== '' && !currentLine().trimEnd().endsWith('(')) newLine(contentIndent);
        append(value);
        return;
      }

      if (value === 'WHEN' || value === 'ELSE') {
        if (currentLine().trim() !== '') newLine(contentIndent + 1);
        append(value, { noLeadingSpace: true });
        return;
      }

      if (value === 'END') {
        if (currentLine().trim() !== '') newLine(contentIndent);
        append(value, { noLeadingSpace: true });
        return;
      }

      const clause = getClause(index);
      if (clause) {
        const lineIndent = clauseLineIndent(clause.value);
        if (currentLine().trim() !== '') newLine(lineIndent);
        append(clause.value, { noLeadingSpace: true });
        contentIndent = clauseContentIndent(clause.value, lineIndent);
        skipCount = clause.consumed - 1;
        newLine(contentIndent);
        return;
      }

      if (SQL_LINE_BREAK_KEYWORDS.has(value) && currentLine().trim() !== '') {
        newLine(contentIndent);
      }
    }

    append(value);
  });

  return lines
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.trim() !== '' || (index > 0 && index < all.length - 1))
    .join('\n')
    .trim();
}

function isLikelySql(code) {
  const text = code.trim();
  if (!text) return false;

  const tokens = tokenizeSql(text).filter((token) => token.type !== 'space');
  const keywordCount = tokens.filter((token) => token.type === 'keyword').length;
  const firstKeyword = tokens.find((token) => token.type === 'keyword')?.value;
  const hasCoreClause = tokens.some((token) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'CREATE', 'ALTER'].includes(token.value));
  const hasRelationalClause = tokens.some((token) => ['FROM', 'JOIN', 'WHERE', 'GROUP', 'ORDER'].includes(token.value));

  return Boolean(
    keywordCount >= 2 &&
    hasCoreClause &&
    (hasRelationalClause || ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER'].includes(firstKeyword))
  );
}

function beautifySqlSelection(text) {
  const fencedCodeRegex = /(```([\w-]*)\s*\n)([\s\S]*?)(\n```)/gi;
  if (fencedCodeRegex.test(text)) {
    return text.replace(fencedCodeRegex, (_, openingFence, language = '', code, closingFence) => {
      const normalizedLanguage = language.toLowerCase();
      const shouldFormat = ['sql', 'mysql', 'postgresql', 'sqlite', 'plsql', 'tsql'].includes(normalizedLanguage)
        || (!normalizedLanguage && isLikelySql(code));

      return shouldFormat
        ? `${openingFence}${formatSql(code)}${closingFence}`
        : `${openingFence}${code}${closingFence}`;
    });
  }

  return formatSql(text);
}

// Use the same deterministic four-space indentation as SQL beautification.
const JSON_INDENT = 4;

function isLikelyJson(code) {
  const text = code.trim();
  if (!text || !/^[{[]/.test(text)) return false;

  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function formatJson(json) {
  return JSON.stringify(JSON.parse(json.trim()), null, JSON_INDENT);
}

function beautifyJsonSelection(text) {
  const fencedCodeRegex = /(```([\w-]*)\s*\n)([\s\S]*?)(\n```)/gi;
  if (fencedCodeRegex.test(text)) {
    let formattedAnyBlock = false;
    const formattedText = text.replace(fencedCodeRegex, (_, openingFence, language = '', code, closingFence) => {
      const normalizedLanguage = language.toLowerCase();
      const shouldFormat = ['json'].includes(normalizedLanguage)
        || (!normalizedLanguage && isLikelyJson(code));

      if (!shouldFormat) return `${openingFence}${code}${closingFence}`;

      formattedAnyBlock = true;
      return `${openingFence}${formatJson(code)}${closingFence}`;
    });

    if (!formattedAnyBlock) {
      throw new Error('No valid JSON fenced code block found in the selection.');
    }

    return formattedText;
  }

  return formatJson(text);
}

function tokenizeJson(code) {
  const rawTokens = Array.from(
    code.matchAll(/("(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]|\s+|.)/g),
    ([, value]) => value
  );

  return rawTokens.map((value, index) => {
    if (/^\s+$/.test(value)) return { type: 'space', value };
    if (/^"/.test(value)) {
      const nextNonSpace = rawTokens.slice(index + 1).find((token) => !/^\s+$/.test(token));
      return { type: nextNonSpace === ':' ? 'key' : 'string', value };
    }
    if (/^-?\d/.test(value)) return { type: 'number', value };
    if (/^(true|false)$/.test(value)) return { type: 'boolean', value };
    if (value === 'null') return { type: 'null', value };
    if (/^[{}\[\],:]$/.test(value)) return { type: 'punctuation', value };
    return { type: 'plain', value };
  });
}

function SqlCodeBlock({ code, language }) {
  return (
    <code className={`language-${language} sql-highlight`}>
      {tokenizeSql(code).map((token, index) => (
        token.type === 'space'
          ? token.value
          : <span key={`${token.type}-${index}`} className={`sql-token sql-token-${token.type}`}>{token.value}</span>
      ))}
    </code>
  );
}

function JsonCodeBlock({ code, language }) {
  return (
    <code className={`language-${language} json-highlight`}>
      {tokenizeJson(code).map((token, index) => (
        token.type === 'space'
          ? token.value
          : <span key={`${token.type}-${index}`} className={`json-token json-token-${token.type}`}>{token.value}</span>
      ))}
    </code>
  );
}

function App() {
  const [theme, setTheme] = useState('light');
  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'dark' ? 'light' : 'dark'));
  };
  const [markdownContent, setMarkdownContent] = useState(`# Welcome to Speculo

Yet another Markdown viewer and editor, but this time this is built by me =P.

---

## Markdown Showcase

### Text Formatting

This is **bold**, this is *italic*, and this is ***bold and italic***.

Inline \`code\` looks like this.

### Blockquote

> "Simplicity is the ultimate sophistication." — Leonardo da Vinci

### Links & Images

Visit [GitHub](https://github.com) for more.

![Placeholder image](https://placehold.co/400x200)

### Ordered List

1. Open a Markdown file
2. Edit in the left pane
3. Preview in the right pane
4. Export when ready

### Unordered List

- Supports GFM (GitHub Flavored Markdown)
- Tables, task lists, and strikethrough
- Fenced code blocks with syntax tokens

### Task List

- [x] Live preview
- [x] Scroll sync
- [x] PDF export
- [ ] Syntax highlighting (coming soon)

### Code Block

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
console.log(greet('Speculo'));
\`\`\`

### Table

| Feature         | Status      |
|-----------------|-------------|
| Live Preview    | ✅ Ready     |
| PDF Export      | ✅ Ready     |
| Scroll Sync     | ✅ Ready     |
| Drag & Drop     | ✅ Ready     |
| Theme Toggle    | ✅ Ready     |
| LaTeX Math      | ✅ Ready     |
| Mermaid Diagrams| ✅ Ready     |
| Syntax Highlight| 🔜 Planned  |

### Horizontal Rule

---

### Strikethrough

~~This text is struck through.~~

### Math (LaTeX)

Inline math: $E = mc^2$

Block math:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

The quadratic formula: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$

### Mermaid Diagram

\`\`\`mermaid
graph TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Great!]
    B -- No --> D[Debug]
    D --> B
\`\`\`

---

*Start editing above or load your own file to get started!*
`);
  const [fileName, setFileName] = useState('document.md');
  // #1: Split isDragging into two separate states
  const [isResizerDragging, setIsResizerDragging] = useState(false);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [dividerPosition, setDividerPosition] = useState(50);
  // Focus mode: 'none' | 'editor' | 'preview'
  const [focusMode, setFocusMode] = useState('none');
  const [focusTarget, setFocusTarget] = useState('editor'); // which pane to maximize
  // #12: Add isExporting state for PDF export button
  const [isExporting, setIsExporting] = useState(false);
  const textareaRef = useRef(null);
  const previewRef = useRef(null);
  // #15: Use useRef for file input instead of document.getElementById
  const fileInputRef = useRef(null);
  // #5: Ref to restore cursor position after controlled update
  const cursorPosRef = useRef(null);
  // Flag to prevent scroll feedback loop
  const isScrollSyncingRef = useRef(false);
  // Track which pane was last focused for toolbar actions
  const lastFocusedPaneRef = useRef('editor'); // 'editor' | 'preview'

  // Undo/redo history stack
  const historyRef = useRef([markdownContent]);
  const historyIndexRef = useRef(0);
  const isUndoRedoRef = useRef(false); // flag to skip pushing during undo/redo

  // Wrapper to update content and push to history
  const updateContent = useCallback((newContent) => {
    if (!isUndoRedoRef.current) {
      // Truncate any redo history beyond current index
      const idx = historyIndexRef.current;
      historyRef.current = historyRef.current.slice(0, idx + 1);
      historyRef.current.push(newContent);
      // Cap history at 200 entries
      if (historyRef.current.length > 200) {
        historyRef.current.shift();
      } else {
        historyIndexRef.current = historyRef.current.length - 1;
      }
    }
    setMarkdownContent(newContent);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      isUndoRedoRef.current = true;
      setMarkdownContent(historyRef.current[historyIndexRef.current]);
      isUndoRedoRef.current = false;
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      isUndoRedoRef.current = true;
      setMarkdownContent(historyRef.current[historyIndexRef.current]);
      isUndoRedoRef.current = false;
    }
  }, []);

  // #5: Restore cursor position after state update re-renders the textarea
  useEffect(() => {
    if (cursorPosRef.current !== null && textareaRef.current) {
      textareaRef.current.selectionStart = cursorPosRef.current;
      textareaRef.current.selectionEnd = cursorPosRef.current;
      cursorPosRef.current = null;
    }
  }, [markdownContent]);

  // Sync mermaid theme with app theme
  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
  }, [theme]);

  // #14: Strip markdown syntax before counting words
  const { wordCount, charCount } = (() => {
    const text = markdownContent;
    const charCount = text.length;
    let plain = text;
    // Remove fenced code blocks (``` ... ```)
    plain = plain.replace(/```[\s\S]*?```/g, '');
    // Remove inline code
    plain = plain.replace(/`[^`]+`/g, '');
    // Remove images ![alt](url)
    plain = plain.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Remove links [text](url) — keep the text
    plain = plain.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Remove autolinks <url>
    plain = plain.replace(/<https?:\/\/[^>]+>/g, '');
    // Remove HTML tags
    plain = plain.replace(/<[^>]*>/g, '');
    // Remove heading markers, bold/italic, strikethrough, blockquote, hr, etc.
    plain = plain.replace(/^#{1,6}\s+/gm, '');
    plain = plain.replace(/^>\s?/gm, '');
    plain = plain.replace(/^[-*_]{3,}\s*$/gm, '');
    plain = plain.replace(/\*{1,3}|_{1,3}|~~|`/g, '');
    // Remove table pipes and alignment markers
    plain = plain.replace(/\|/g, ' ');
    plain = plain.replace(/^[\s:|-]+$/gm, '');
    // Remove math delimiters
    plain = plain.replace(/\$\$/g, '');
    plain = plain.replace(/\$/g, '');
    const wordCount = plain.trim() === '' ? 0 : plain.trim().split(/\s+/).length;
    return { wordCount, charCount };
  })();

  // #6-7: Ratio-based scroll sync (textarea → preview)
  const handleScroll = useCallback(() => {
    if (!isSyncing || !textareaRef.current || !previewRef.current) return;
    if (isScrollSyncingRef.current) return;
    isScrollSyncingRef.current = true;

    const textarea = textareaRef.current;
    const preview = previewRef.current;
    const maxTextareaScroll = textarea.scrollHeight - textarea.clientHeight;
    if (maxTextareaScroll > 0) {
      const scrollRatio = textarea.scrollTop / maxTextareaScroll;
      preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight);
    }

    requestAnimationFrame(() => { isScrollSyncingRef.current = false; });
  }, [isSyncing]);

  // #6: Reverse sync (preview → textarea)
  const handlePreviewScroll = useCallback(() => {
    if (!isSyncing || !textareaRef.current || !previewRef.current) return;
    if (isScrollSyncingRef.current) return;
    isScrollSyncingRef.current = true;

    const textarea = textareaRef.current;
    const preview = previewRef.current;
    const maxPreviewScroll = preview.scrollHeight - preview.clientHeight;
    if (maxPreviewScroll > 0) {
      const scrollRatio = preview.scrollTop / maxPreviewScroll;
      textarea.scrollTop = scrollRatio * (textarea.scrollHeight - textarea.clientHeight);
    }

    requestAnimationFrame(() => { isScrollSyncingRef.current = false; });
  }, [isSyncing]);

  const handleContentChange = (e) => {
    updateContent(e.target.value);
  };

  // #5: Handle Tab, Undo, Redo keyboard shortcuts
  const handleKeyDown = useCallback((e) => {
    const isMod = e.metaKey || e.ctrlKey;

    // Undo: Ctrl+Z / Cmd+Z
    if (isMod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }

    // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y / Cmd+Y
    if ((isMod && e.key === 'z' && e.shiftKey) || (isMod && e.key === 'y')) {
      e.preventDefault();
      redo();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;

      const prev = markdownContent;
      const newText = prev.substring(0, start) + '    ' + prev.substring(end);
      cursorPosRef.current = start + 4;
      updateContent(newText);
    }
  }, [undo, redo, markdownContent, updateContent]);

  // #3: Clear isFileDragging on drop; #13: Error for non-.md files
  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        historyRef.current = [content];
        historyIndexRef.current = 0;
        setMarkdownContent(content);
        setFileName(file.name);
      };
      reader.readAsText(file);
    } else if (file) {
      setCopyStatus('Only .md files are supported.');
      setTimeout(() => setCopyStatus(''), 3000);
    }
  }, []);

  // #1: Only set file drag state
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragging(true);
  }, []);

  // #2: Reset file drag state when cursor leaves drop zone
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragging(false);
  }, []);

  // #1: Use isResizerDragging instead of isDragging
  const handleMouseMove = useCallback((e) => {
    if (!isResizerDragging) return;
    const container = e.currentTarget;
    const containerRect = container.getBoundingClientRect();
    let newX = e.clientX - containerRect.left;
    let newPercentage = (newX / containerRect.width) * 100;
    newPercentage = Math.max(10, Math.min(90, newPercentage));
    setDividerPosition(newPercentage);
  }, [isResizerDragging]);

  // #8 & #19: Attach mouseup to window with useEffect cleanup
  useEffect(() => {
    const handleMouseUp = () => {
      setIsResizerDragging(false);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Global undo/redo: fires when textarea is not focused (e.g. preview focus mode)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (document.activeElement === textareaRef.current) return; // textarea handles it
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((isMod && e.key === 'z' && e.shiftKey) || (isMod && e.key === 'y')) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [undo, redo]);

  // Feature 1: Replaced alert with status message
  const handleCopy = useCallback(async () => {
    try {
      const previewElement = previewRef.current;
      if (!previewElement) return;
      
      // Get the visible text content from the preview area
      const textToCopy = previewElement.innerText; 
      
      await navigator.clipboard.writeText(textToCopy);
      setCopyStatus('Preview content copied to clipboard!');
      setTimeout(() => setCopyStatus(''), 3000); // Clear status after 3 seconds
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopyStatus('Failed to copy content.');
    }
  }, []);

  const handleDownloadMd = useCallback(() => {
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [markdownContent, fileName]);

  // #13: Error feedback for wrong file type
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        historyRef.current = [content];
        historyIndexRef.current = 0;
        setMarkdownContent(content);
        setFileName(file.name);
      };
      reader.readAsText(file);
    } else if (file) {
      setCopyStatus('Only .md files are supported.');
      setTimeout(() => setCopyStatus(''), 3000);
    }
  }, []);

  // Helper: get plain text selection from the preview pane
  const getPreviewSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !previewRef.current) return null;
    // Only use if the selection is inside the preview area
    if (!previewRef.current.contains(sel.anchorNode)) return null;
    return sel.toString();
  }, []);

  // Helper: find text in markdown source and return its position
  // Strips common markdown syntax to match plain rendered text back to source
  const findInSource = useCallback((plainText) => {
    if (!plainText) return null;
    const searchText = plainText.trim();
    if (!searchText) return null;

    // Direct search first (handles multi-line verbatim matches)
    const directIdx = markdownContent.indexOf(searchText);
    if (directIdx !== -1) {
      return { start: directIdx, end: directIdx + searchText.length };
    }

    // For multi-line selections, find the range from first line match to last line match
    const searchLines = searchText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (searchLines.length === 0) return null;

    // Strip function to normalize a source line for comparison
    const stripLine = (line) => line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    const sourceLines = markdownContent.split('\n');
    let firstMatchOffset = null;
    let lastMatchEnd = null;
    let sourceOffset = 0;
    let searchIdx = 0;

    for (let i = 0; i < sourceLines.length && searchIdx < searchLines.length; i++) {
      const stripped = stripLine(sourceLines[i]);
      if (stripped.includes(searchLines[searchIdx])) {
        if (firstMatchOffset === null) {
          firstMatchOffset = sourceOffset;
        }
        lastMatchEnd = sourceOffset + sourceLines[i].length;
        searchIdx++;
      } else if (firstMatchOffset !== null && sourceLines[i].trim() === '') {
        // Allow blank lines in between
        lastMatchEnd = sourceOffset + sourceLines[i].length;
      }
      sourceOffset += sourceLines[i].length + 1;
    }

    if (firstMatchOffset !== null && searchIdx === searchLines.length) {
      return { start: firstMatchOffset, end: lastMatchEnd };
    }

    // Single-line fuzzy fallback (original logic)
    sourceOffset = 0;
    for (const line of sourceLines) {
      const stripped = stripLine(line);
      const idx = stripped.indexOf(searchText);
      if (idx !== -1) {
        let strippedPos = 0;
        let origPos = 0;
        while (strippedPos < idx && origPos < line.length) {
          if (line.substring(origPos).match(/^(\*\*\*|\*\*|\*|~~|`|#{1,6}\s|>\s?)/)) {
            const m = line.substring(origPos).match(/^(\*\*\*|\*\*|\*|~~|`|#{1,6}\s|>\s?)/);
            origPos += m[1].length;
          } else if (line[origPos] === '[') {
            origPos++;
          } else {
            origPos++;
            strippedPos++;
          }
        }
        const matchStart = sourceOffset + origPos;
        let remaining = searchText.length;
        let endPos = origPos;
        while (remaining > 0 && endPos < line.length) {
          if (line.substring(endPos).match(/^(\*\*\*|\*\*|\*|~~|`)/)) {
            const m = line.substring(endPos).match(/^(\*\*\*|\*\*|\*|~~|`)/);
            endPos += m[1].length;
          } else if (line.substring(endPos).match(/^\]\([^)]+\)/)) {
            const m = line.substring(endPos).match(/^\]\([^)]+\)/);
            endPos += m[0].length;
          } else {
            endPos++;
            remaining--;
          }
        }
        return { start: matchStart, end: sourceOffset + endPos };
      }
      sourceOffset += line.length + 1;
    }

    return null;
  }, [markdownContent]);

  // Helper: apply inline/prefix formatting to each line of a multi-line string
  const formatLines = useCallback((text, before, after) => {
    const lines = text.split('\n');
    return lines.map(line => {
      if (line.trim() === '') return line; // preserve blank lines
      return before + line + after;
    }).join('\n');
  }, []);

  // WYSIWYG toolbar: insert markdown at cursor position or around preview selection
  const insertMarkdown = useCallback((before, after = '', placeholder = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Check if user selected text in the preview pane
    const previewSelection = lastFocusedPaneRef.current === 'preview' ? getPreviewSelection() : null;

    if (previewSelection) {
      const pos = findInSource(previewSelection);
      if (pos) {
        const selectedSource = markdownContent.substring(pos.start, pos.end);
        // Multi-line: format each line individually
        const formatted = selectedSource.includes('\n')
          ? formatLines(selectedSource, before, after)
          : before + selectedSource + after;
        const newText = markdownContent.substring(0, pos.start) + formatted + markdownContent.substring(pos.end);
        updateContent(newText);
        window.getSelection()?.removeAllRanges();
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.selectionStart = pos.start;
          textarea.selectionEnd = pos.start + formatted.length;
        });
        return;
      }
    }

    // Default: operate on editor textarea selection
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = markdownContent.substring(start, end);

    // Multi-line selection: apply formatting to each line
    if (selected && selected.includes('\n')) {
      const formatted = formatLines(selected, before, after);
      const newText = markdownContent.substring(0, start) + formatted + markdownContent.substring(end);
      updateContent(newText);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start;
        textarea.selectionEnd = start + formatted.length;
      });
      return;
    }

    // Single-line or no selection
    const insert = selected || placeholder;
    const newText = markdownContent.substring(0, start) + before + insert + after + markdownContent.substring(end);
    updateContent(newText);
    const cursorPos = selected
      ? start + before.length + insert.length + after.length
      : start + before.length;
    const cursorEnd = selected
      ? cursorPos
      : cursorPos + insert.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = cursorPos === cursorEnd ? cursorPos : cursorPos;
      textarea.selectionEnd = cursorEnd;
    });
  }, [markdownContent, getPreviewSelection, findInSource, formatLines, updateContent]);

  const insertBlock = useCallback((block) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // If preview is focused, insert at the end of the source
    const start = lastFocusedPaneRef.current === 'preview'
      ? markdownContent.length
      : textarea.selectionStart;

    const beforeText = markdownContent.substring(0, start);
    const prefix = beforeText.endsWith('\n') || beforeText === '' ? '' : '\n';
    const newText = beforeText + prefix + block + '\n' + markdownContent.substring(start);
    updateContent(newText);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + prefix.length + block.length + 1;
    });
  }, [markdownContent, updateContent]);

  const handleBeautifySql = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const previewSelection = lastFocusedPaneRef.current === 'preview' ? getPreviewSelection() : null;

    if (previewSelection) {
      const pos = findInSource(previewSelection);
      if (pos) {
        const selectedSource = markdownContent.substring(pos.start, pos.end);
        const formatted = beautifySqlSelection(selectedSource);
        const newText = markdownContent.substring(0, pos.start) + formatted + markdownContent.substring(pos.end);
        updateContent(newText);
        window.getSelection()?.removeAllRanges();
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.selectionStart = pos.start;
          textarea.selectionEnd = pos.start + formatted.length;
        });
        setCopyStatus('SQL selection beautified!');
        setTimeout(() => setCopyStatus(''), 3000);
        return;
      }
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = markdownContent.substring(start, end);

    if (!selected.trim()) {
      setCopyStatus('Highlight SQL code first, then click Beautify SQL.');
      setTimeout(() => setCopyStatus(''), 3000);
      textarea.focus();
      return;
    }

    const formatted = beautifySqlSelection(selected);
    const newText = markdownContent.substring(0, start) + formatted + markdownContent.substring(end);
    updateContent(newText);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start;
      textarea.selectionEnd = start + formatted.length;
    });
    setCopyStatus('SQL selection beautified!');
    setTimeout(() => setCopyStatus(''), 3000);
  }, [markdownContent, getPreviewSelection, findInSource, updateContent]);

  const handleBeautifyJson = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const showError = (message = 'Invalid JSON. Please highlight valid JSON data first.') => {
      setCopyStatus(message);
      setTimeout(() => setCopyStatus(''), 3000);
    };

    const previewSelection = lastFocusedPaneRef.current === 'preview' ? getPreviewSelection() : null;

    if (previewSelection) {
      const pos = findInSource(previewSelection);
      if (pos) {
        try {
          const selectedSource = markdownContent.substring(pos.start, pos.end);
          const formatted = beautifyJsonSelection(selectedSource);
          const newText = markdownContent.substring(0, pos.start) + formatted + markdownContent.substring(pos.end);
          updateContent(newText);
          window.getSelection()?.removeAllRanges();
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.selectionStart = pos.start;
            textarea.selectionEnd = pos.start + formatted.length;
          });
          setCopyStatus('JSON selection beautified!');
          setTimeout(() => setCopyStatus(''), 3000);
        } catch (err) {
          showError(err.message);
        }
        return;
      }
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = markdownContent.substring(start, end);

    if (!selected.trim()) {
      showError('Highlight JSON data first, then click Beautify JSON.');
      textarea.focus();
      return;
    }

    try {
      const formatted = beautifyJsonSelection(selected);
      const newText = markdownContent.substring(0, start) + formatted + markdownContent.substring(end);
      updateContent(newText);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start;
        textarea.selectionEnd = start + formatted.length;
      });
      setCopyStatus('JSON selection beautified!');
      setTimeout(() => setCopyStatus(''), 3000);
    } catch (err) {
      showError(err.message);
      textarea.focus();
    }
  }, [markdownContent, getPreviewSelection, findInSource, updateContent]);

  // parseInline – handles bold, italic, bold+italic (both * and _ syntax),
  // strikethrough, inline code, links, autolinks, and plain text
  const parseInline = (text) => {
    const parts = [];
    // Order: inline math ($$...$$, $...$), bold+italic, bold, italic, strikethrough, code, link, autolink, plain
    // Uses [^*], [^_] etc. to prevent greedy matches across adjacent inline elements
    const regex = /(\$\$([^$]+?)\$\$|\$([^$]+?)\$|\*\*\*([^*]+?)\*\*\*|___([^_]+?)___|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*]+?)\*|_([^_]+?)_|~~([^~]+?)~~|`([^`]+?)`|\[([^\]]+)\]\(([^)]+)\)|<(https?:\/\/[^>]+)>|([^*_`~\[$<]+))/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[2])       parts.push({ text: match[2].trim(), fontSize: 10, italics: true, color: '#6a0dad', background: '#f3e8ff' });
      else if (match[3])  parts.push({ text: match[3].trim(), fontSize: 10, italics: true, color: '#6a0dad', background: '#f3e8ff' });
      else if (match[4])  parts.push({ text: match[4], bold: true, italics: true });
      else if (match[5])  parts.push({ text: match[5], bold: true, italics: true });
      else if (match[6])  parts.push({ text: match[6], bold: true });
      else if (match[7])  parts.push({ text: match[7], bold: true });
      else if (match[8])  parts.push({ text: match[8], italics: true });
      else if (match[9])  parts.push({ text: match[9], italics: true });
      else if (match[10]) parts.push({ text: match[10], decoration: 'lineThrough', color: '#888' });
      else if (match[11]) parts.push({ text: match[11], fontSize: 10, background: '#f5f5f5' });
      else if (match[12]) parts.push({ text: match[12], link: match[13], color: 'blue', decoration: 'underline' });
      else if (match[14]) parts.push({ text: match[14], link: match[14], color: 'blue', decoration: 'underline' });
      else if (match[15]) parts.push({ text: match[15] });
    }
    return parts.length ? parts : [{ text }];
  };

  // #12: Add loading/disabled state on Export PDF button
  const handleExportPdf = useCallback(async () => {
    setIsExporting(true);
    try {
      const tokens = marked.lexer(markdownContent, { gfm: true });
      const content = [];

      // Helper: detect block math ($$...$$) in paragraph text
      const blockMathRegex = /^\$\$([\s\S]+?)\$\$$/;

    for (const token of tokens) {
      switch (token.type) {
        case 'heading':
          content.push({
            text: token.text,
            style: `h${token.depth}`,
            margin: [0, token.depth === 1 ? 14 : 10, 0, 4],
          });
          break;

        case 'paragraph': {
          // Check if paragraph contains an image sub-token
          const imgToken = token.tokens?.find((t) => t.type === 'image');
          if (imgToken) {
            try {
              const { dataUrl: imgData, width: natW } = await imageUrlToDataUrl(imgToken.href);
              const maxW = 400;
              const displayW = Math.min(natW, maxW);
              content.push({
                image: imgData,
                width: displayW,
                alignment: 'center',
                margin: [0, 4, 0, 4],
              });
              if (imgToken.text) {
                content.push({
                  text: imgToken.text,
                  style: 'body',
                  alignment: 'center',
                  italics: true,
                  color: '#666',
                  fontSize: 9,
                  margin: [0, 0, 0, 8],
                });
              }
            } catch {
              content.push({
                text: `[Image: ${imgToken.text || imgToken.href}]`,
                style: 'body',
                italics: true,
                color: '#666',
                margin: [0, 0, 0, 8],
              });
            }
            break;
          }
          // Check if the entire paragraph is a block math expression
          const mathMatch = blockMathRegex.exec(token.raw.trim());
          if (mathMatch) {
            try {
              const dataUrl = await katexToDataUrl(mathMatch[1].trim(), true);
              content.push({
                image: dataUrl,
                width: 200,
                alignment: 'center',
                margin: [0, 6, 0, 6],
              });
            } catch {
              content.push({
                text: token.raw.trim(),
                style: 'code',
                margin: [0, 4, 0, 8],
              });
            }
          } else {
            content.push({
              text: parseInline(token.text),
              style: 'body',
              margin: [0, 0, 0, 8],
            });
          }
          break;
        }

        case 'list': {
          // Recursive helper to handle nested lists and task list checkboxes
          const buildList = (listToken) => {
            const items = listToken.items.map((item) => {
              const prefix = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
              const inlineContent = parseInline(prefix + (item.text || ''));

              // Check for nested sub-lists inside this item's tokens
              const nestedList = item.tokens?.find((t) => t.type === 'list');
              if (nestedList) {
                return [
                  { text: inlineContent, style: 'body' },
                  buildList(nestedList),
                ];
              }
              return { text: inlineContent, style: 'body' };
            });

            return {
              [listToken.ordered ? 'ol' : 'ul']: items,
              margin: [0, 0, 0, 8],
            };
          };
          content.push(buildList(token));
          break;
        }

        case 'code':
          if (token.lang === 'mermaid') {
            try {
              const mermaidId = `pdf-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              // Use light theme for PDF without mutating global mermaid config
              const prevTheme = theme === 'dark' ? 'dark' : 'default';
              mermaid.initialize({ startOnLoad: false, theme: 'default' });
              const { svg } = await mermaid.render(mermaidId, token.text);
              mermaid.initialize({ startOnLoad: false, theme: prevTheme });
              const dataUrl = await svgToDataUrl(svg, 220, 2);
              content.push({
                image: dataUrl,
                width: 220,
                alignment: 'center',
                margin: [0, 6, 0, 8],
              });
            } catch {
              content.push({
                text: '[Mermaid Diagram — could not render]',
                style: 'body',
                italics: true,
                color: '#666',
                margin: [0, 4, 0, 8],
              });
            }
          } else {
            content.push({
              table: {
                widths: ['*'],
                body: [[{
                  text: token.text,
                  style: 'code',
                  border: [false, false, false, false],
                }]],
              },
              fillColor: '#f5f5f5',
              margin: [0, 0, 0, 10],
            });
          }
          break;

        case 'blockquote': {
          // Walk sub-tokens for formatted blockquote content
          const bqParts = [];
          if (token.tokens && token.tokens.length) {
            token.tokens.forEach((sub) => {
              if (sub.type === 'paragraph') {
                bqParts.push(...parseInline(sub.text));
              } else if (sub.text) {
                bqParts.push(...parseInline(sub.text));
              }
            });
          } else {
            bqParts.push(...parseInline(token.text.replace(/^>\s?/gm, '')));
          }
          // Left border bar using table with noBorders layout so fillColor shows
          content.push({
            table: {
              widths: [2, '*'],
              body: [[
                { text: ' ', fillColor: '#aaaaaa' },
                { text: bqParts, style: 'blockquote', margin: [8, 4, 0, 4] },
              ]],
            },
            layout: 'noBorders',
            margin: [0, 4, 0, 8],
          });
          break;
        }

        case 'hr':
          content.push({
            canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#cccccc' }],
            margin: [0, 8, 0, 8],
          });
          break;

        case 'space':
          content.push({ text: '', margin: [0, 4, 0, 4] });
          break;
        
        case 'table': {
          const headerRow = token.header.map((cell) => ({
            text: cell.text,
            style: 'tableHeader',
            fillColor: '#f0f0f0',
          }));

          const bodyRows = token.rows.map((row) =>
            row.map((cell) => ({
              text: parseInline(cell.text),
              style: 'tableCell',
            }))
          );

          const colCount = token.header.length;
          const colWidths = Array(colCount).fill(`${Math.floor(100 / colCount)}%`);

          content.push({
            table: {
              headerRows: 1,
              widths: colWidths,
              body: [headerRow, ...bodyRows],
            },
            layout: {
              hLineWidth: (i, node) =>
                (i === 0 || i === 1 || i === node.table.body.length) ? 1.5 : 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => '#cccccc',
              vLineColor: () => '#cccccc',
              paddingLeft: () => 8,
              paddingRight: () => 8,
              paddingTop: () => 5,
              paddingBottom: () => 5,
            },
            margin: [0, 6, 0, 12],
          });
          break;
        }

        // #10: Fetch remote images and embed as base64 in the PDF
        case 'image': {
          try {
            const { dataUrl: imgData, width: natW } = await imageUrlToDataUrl(token.href);
            const maxW = 400;
            const displayW = Math.min(natW, maxW);
            content.push({
              image: imgData,
              width: displayW,
              alignment: 'center',
              margin: [0, 4, 0, 8],
            });
            if (token.text) {
              content.push({
                text: token.text,
                style: 'body',
                alignment: 'center',
                italics: true,
                color: '#666',
                fontSize: 9,
                margin: [0, 0, 0, 8],
              });
            }
          } catch {
            content.push({
              text: `[Image: ${token.text || token.href}]`,
              style: 'body',
              italics: true,
              color: '#666',
              margin: [0, 0, 0, 8],
            });
          }
          break;
        }

        // HTML blocks – strip tags and render as plain text fallback
        case 'html': {
          const stripped = token.text.replace(/<[^>]*>/g, '').trim();
          if (stripped) {
            content.push({
              text: stripped,
              style: 'body',
              margin: [0, 0, 0, 8],
            });
          }
          break;
        }

        default:
          break;
      }
    }

    const docDefinition = {
      content,
      defaultStyle: { font: 'Roboto' },
      styles: {
        h1: { fontSize: 26, bold: true, color: '#111' },
        h2: { fontSize: 22, bold: true, color: '#222' },
        h3: { fontSize: 18, bold: true, color: '#333' },
        h4: { fontSize: 15, bold: true },
        h5: { fontSize: 13, bold: true },
        h6: { fontSize: 11, bold: true },
        body: { fontSize: 11, lineHeight: 1.5, color: '#222' },
        code: { font: 'Roboto', fontSize: 9.5, color: '#333' },
        blockquote: { fontSize: 11, italics: true, color: '#555' },
        tableHeader: { fontSize: 10, bold: true, color: '#111' },
        tableCell: { fontSize: 10, color: '#333', lineHeight: 1.4 },
      },
      pageMargins: [50, 50, 50, 50],
    };

    pdfMake
      .createPdf(docDefinition)
      .download(fileName.replace(/\.md$/, '') + '.pdf');
    } finally {
      setIsExporting(false);
    }
  }, [markdownContent, fileName, theme]);

  return (
    <div className={`md-viewer-container ${theme}`}>
      <div className="sidebar">
        {/* #16: Drop Zone (sidebar is a horizontal row, not left/right columns) */}
        <div 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleFileDrop} 
          className={`drop-zone ${isFileDragging ? 'dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <p>Drag & Drop or Click to load .md</p>
        </div>
        {/* #16: Action Buttons + Status */}
        <div className="button-section">
          <div className="button-group">
            <button
              onClick={handleDownloadMd}
              className="download-md"
              title="Download the current editor content as a Markdown (.md) file"
            >
              Save Raw MD File
            </button>
            <button
              onClick={handleCopy}
              className="copy-toggle"
              title="Copy the rendered preview text to your clipboard"
            >
              Copy to Clipboard
            </button>
            {/* #12: Disable button and show feedback while exporting */}
            <button
              onClick={handleExportPdf}
              className="export-pdf"
              disabled={isExporting}
              title="Export the rendered Markdown preview as a PDF file"
            >
              {isExporting ? 'Exporting…' : 'Export to PDF'}
            </button>
            {/* Focus mode: maximize editor or preview */}
            <button
              onClick={() => setFocusMode(focusMode === 'none' ? focusTarget : 'none')}
              title="Toggle focus mode to show only the editor or only the preview"
            >
              {focusMode !== 'none' ? 'Exit Focus' : 'Focus'}
            </button>
            <button
              onClick={toggleTheme}
              className="theme-toggle"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button
              onClick={() => setIsSyncing(!isSyncing)}
              className="sync-toggle"
              title={`${isSyncing ? 'Disable' : 'Enable'} synchronized scrolling between editor and preview`}
            >
              {isSyncing ? 'Sync On' : 'Sync Off'}
            </button>
          </div>

          <div className="copy-status-message">
            {copyStatus && (
              <span style={{ color: copyStatus.includes('Failed') || copyStatus.includes('Only') ? '#ff6b6b' : '#51cf66' }}>
                {copyStatus}
              </span>
            )}
          </div>
        </div>

        {/* #15: Use ref instead of document.getElementById */}
        <input type="file" ref={fileInputRef} accept=".md" onChange={handleFileSelect} style={{ display: 'none' }} />

        {/* #16: File Info section */}
        <div className="file-info">
          {/* #17: Truncate long filenames */}
          <p className="file-name" style={{margin: 0}}><strong>{fileName}</strong></p>
          <p className="word-count" style={{margin: 0, opacity: 0.7}}>
            {wordCount} words | {charCount} chars
          </p>
        </div>
      </div>
      {/* WYSIWYG Formatting Toolbar */}
      <div className="formatting-toolbar" onMouseDown={(e) => e.preventDefault()}>
        {/* Frequent inline formatting */}
        <div className="toolbar-group">
          <button title="Make selected text bold using Markdown **bold** syntax" onClick={() => insertMarkdown('**', '**', 'bold')}>
            <strong>B</strong>
          </button>
          <button title="Make selected text italic using Markdown *italic* syntax" onClick={() => insertMarkdown('*', '*', 'italic')}>
            <em>I</em>
          </button>
          <button title="Insert or wrap selected text as a Markdown link" onClick={() => insertMarkdown('[', '](url)', 'link text')}>
            &#128279; Link
          </button>
          <button title="Strike through selected text using Markdown ~~text~~ syntax" onClick={() => insertMarkdown('~~', '~~', 'strikethrough')}>
            <s>S</s>
          </button>
          <button title="Format selected text as inline code using backticks" onClick={() => insertMarkdown('`', '`', 'code')}>
            <code>&lt;/&gt;</code>
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <button title="Insert a level 1 heading (# Heading)" onClick={() => insertMarkdown('# ', '', 'Heading 1')}>H1</button>
          <button title="Insert a level 2 heading (## Heading)" onClick={() => insertMarkdown('## ', '', 'Heading 2')}>H2</button>
          <button title="Insert a level 3 heading (### Heading)" onClick={() => insertMarkdown('### ', '', 'Heading 3')}>H3</button>
        </div>
        <span className="toolbar-divider" />
        {/* Common document structure */}
        <div className="toolbar-group">
          <button title="Insert a bulleted Markdown list item" onClick={() => insertBlock('- List item')}>
            &#8226; List
          </button>
          <button title="Insert a numbered Markdown list item" onClick={() => insertBlock('1. List item')}>
            1. List
          </button>
          <button title="Insert a GitHub-style task checkbox item" onClick={() => insertBlock('- [ ] Task item')}>
            &#9744; Task
          </button>
          <button title="Format selected text as a Markdown blockquote" onClick={() => insertMarkdown('> ', '', 'quote')}>
            &#10077; Quote
          </button>
          <button title="Insert a simple two-column Markdown table" onClick={() => insertBlock('| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |')}>
            &#9638; Table
          </button>
        </div>
        <span className="toolbar-divider" />
        {/* Code and technical writing */}
        <div className="toolbar-group">
          <button title="Insert a fenced code block for multi-line code snippets" onClick={() => insertBlock('```\ncode here\n```')}>
            &#123;&#125; Code
          </button>
          <button title="Beautify the highlighted SQL selection or SQL fenced code block" onClick={handleBeautifySql}>
            SQL Beautify
          </button>
          <button title="Beautify the highlighted JSON selection or JSON fenced code block" onClick={handleBeautifyJson}>
            JSON Beautify
          </button>
        </div>
        <span className="toolbar-divider" />
        {/* Less frequent media and advanced inserts */}
        <div className="toolbar-group">
          <button title="Insert or wrap selected text as a Markdown image with alt text and URL" onClick={() => insertMarkdown('![', '](url)', 'alt text')}>
            &#128247; Image
          </button>
          <button title="Insert a horizontal divider line (---)" onClick={() => insertBlock('---')}>
            &#8213; Rule
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <button title="Insert inline LaTeX math using single dollar signs" onClick={() => insertMarkdown('$', '$', 'E = mc^2')}>
            &#120536; Math
          </button>
          <button title="Insert a display LaTeX math block using double dollar signs" onClick={() => insertBlock('$$\nx^2 + y^2 = z^2\n$$')}>
            &#8721; Block Math
          </button>
          <button title="Insert a Mermaid diagram fenced code block" onClick={() => insertBlock('```mermaid\ngraph TD\n    A[Start] --> B[End]\n```')}>
            &#9670; Mermaid
          </button>
        </div>
      </div>
      <div className="editor-area">
        {/* Floating focus switch – upper right when in focus mode */}
        {focusMode !== 'none' && (
          <div className="focus-overlay">
            <div className="focus-switch">
              <button
                className={`focus-switch-option${focusTarget === 'editor' ? ' selected' : ''}`}
                onClick={() => { setFocusTarget('editor'); setFocusMode('editor'); }}
              >
                Editor
              </button>
              <button
                className={`focus-switch-option${focusTarget === 'preview' ? ' selected' : ''}`}
                onClick={() => { setFocusTarget('preview'); setFocusMode('preview'); }}
              >
                Preview
              </button>
            </div>
            <button
              className="focus-overlay-exit"
              onClick={() => setFocusMode('none')}
            >
              Exit Focus
            </button>
          </div>
        )}
        {/* #8: onMouseUp removed from here — now on window */}
        <div 
          className="content-wrapper"
          onMouseMove={handleMouseMove}
        >
          <div 
            className="markdown-input-container" 
            style={{
              flexBasis: focusMode === 'none' ? `${dividerPosition}%` : undefined,
              display: focusMode === 'preview' ? 'none' : undefined,
              flexGrow: focusMode === 'editor' ? 1 : undefined,
            }}
          >
            <textarea
              ref={textareaRef}
              className="markdown-input"
              value={markdownContent}
              onChange={handleContentChange}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              onFocus={() => { lastFocusedPaneRef.current = 'editor'; }}
              placeholder="Enter Markdown here..."
            />
          </div >
          
          {/* Resizable Divider — #1: uses isResizerDragging */}
          {focusMode === 'none' && (
            <div 
              className="resizer" 
              onMouseDown={() => setIsResizerDragging(true)}
            />
          )}

          {/* #6: Bidirectional scroll sync */}
          <div
            className="preview-area"
            ref={previewRef}
            onScroll={handlePreviewScroll}
            onMouseDown={() => { lastFocusedPaneRef.current = 'preview'; }}
            style={{
              display: focusMode === 'editor' ? 'none' : undefined,
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match?.[1]?.toLowerCase();
                  if (!inline && match && match[1] === 'mermaid') {
                    return <MermaidDiagram>{children}</MermaidDiagram>;
                  }
                  const codeText = String(children).replace(/\n$/, '');
                  if (!inline && (
                    ['sql', 'mysql', 'postgresql', 'sqlite', 'plsql', 'tsql'].includes(language)
                    || (!language && isLikelySql(codeText))
                  )) {
                    return <SqlCodeBlock code={codeText} language={language || 'sql'} />;
                  }
                  if (!inline && (language === 'json' || (!language && isLikelyJson(codeText)))) {
                    return <JsonCodeBlock code={codeText} language={language || 'json'} />;
                  }
                  return <code className={className} {...props}>{children}</code>;
                }
              }}
            >
              {markdownContent}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;



