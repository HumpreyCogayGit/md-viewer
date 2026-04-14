import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { marked } from 'marked';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import './App.css';

// #18: Safe vfs assignment for pdfmake v0.2+
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

function App() {
  const [theme, setTheme] = useState('dark');
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
| Syntax Highlight| 🔜 Planned  |

### Horizontal Rule

---

### Strikethrough

~~This text is struck through.~~

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

  // #5: Restore cursor position after state update re-renders the textarea
  useEffect(() => {
    if (cursorPosRef.current !== null && textareaRef.current) {
      textareaRef.current.selectionStart = cursorPosRef.current;
      textareaRef.current.selectionEnd = cursorPosRef.current;
      cursorPosRef.current = null;
    }
  }, [markdownContent]);

  // #14: Strip markdown syntax before counting words
  const { wordCount, charCount } = (() => {
    const text = markdownContent;
    const charCount = text.length;
    const plainText = text.replace(/[#*_`>~\[\]!|]/g, '');
    const wordCount = plainText.trim() === '' ? 0 : plainText.trim().split(/\s+/).length;
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

    isScrollSyncingRef.current = false;
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

    isScrollSyncingRef.current = false;
  }, [isSyncing]);

  const handleContentChange = (e) => {
    setMarkdownContent(e.target.value);
  };

  // #5: Handle Tab without direct DOM mutation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;

      setMarkdownContent((prev) => {
        const newText = prev.substring(0, start) + '    ' + prev.substring(end);
        cursorPosRef.current = start + 4;
        return newText;
      });
    }
  }, []);

  // #3: Clear isFileDragging on drop; #13: Error for non-.md files
  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setMarkdownContent(event.target.result);
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
        setMarkdownContent(event.target.result);
        setFileName(file.name);
      };
      reader.readAsText(file);
    } else if (file) {
      setCopyStatus('Only .md files are supported.');
      setTimeout(() => setCopyStatus(''), 3000);
    }
  }, []);

  // parseInline – handles bold, italic, bold+italic (both * and _ syntax),
  // strikethrough, inline code, links, autolinks, and plain text
  const parseInline = (text) => {
    const parts = [];
    // Order: bold+italic, bold, italic, strikethrough, code, link, autolink, plain
    const regex = /(\*\*\*(.+?)\*\*\*|___(.+?)___|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|~~(.+?)~~|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)|<(https?:\/\/[^>]+)>|([^*_`~\[<]+))/gs;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[2])       parts.push({ text: match[2], bold: true, italics: true });
      else if (match[3])  parts.push({ text: match[3], bold: true, italics: true });
      else if (match[4])  parts.push({ text: match[4], bold: true });
      else if (match[5])  parts.push({ text: match[5], bold: true });
      else if (match[6])  parts.push({ text: match[6], italics: true });
      else if (match[7])  parts.push({ text: match[7], italics: true });
      else if (match[8])  parts.push({ text: match[8], decoration: 'lineThrough', color: '#888' });
      else if (match[9])  parts.push({ text: match[9], fontSize: 10, background: '#f5f5f5' });
      else if (match[10]) parts.push({ text: match[10], link: match[11], color: 'blue', decoration: 'underline' });
      else if (match[12]) parts.push({ text: match[12], link: match[12], color: 'blue', decoration: 'underline' });
      else if (match[13]) parts.push({ text: match[13] });
    }
    return parts.length ? parts : [{ text }];
  };

  // #12: Add loading/disabled state on Export PDF button
  const handleExportPdf = useCallback(async () => {
    setIsExporting(true);
    try {
      const tokens = marked.lexer(markdownContent, { gfm: true });
      const content = [];

    tokens.forEach((token) => {
      switch (token.type) {
        case 'heading':
          content.push({
            text: token.text,
            style: `h${token.depth}`,
            margin: [0, token.depth === 1 ? 14 : 10, 0, 4],
          });
          break;

        case 'paragraph':
          content.push({
            text: parseInline(token.text),
            style: 'body',
            margin: [0, 0, 0, 8],
          });
          break;

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
          content.push({
            text: bqParts,
            style: 'blockquote',
            margin: [12, 0, 0, 8],
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

        // #10: Image token – render alt text since pdfMake can't fetch remote images inline
        case 'image':
          content.push({
            text: `[Image: ${token.text || token.href}]`,
            style: 'body',
            italics: true,
            color: '#666',
            margin: [0, 0, 0, 8],
          });
          break;

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
    });

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
  }, [markdownContent, fileName]);

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
            <button onClick={toggleTheme} className="theme-toggle">
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button onClick={() => setIsSyncing(!isSyncing)} className="sync-toggle">
              {isSyncing ? 'Sync On' : 'Sync Off'}
            </button>            
            <button onClick={handleDownloadMd} className="download-md">Save Raw MD File</button>
            <button onClick={handleCopy} className="copy-toggle">Copy to Clipboard</button>
            {/* #12: Disable button and show feedback while exporting */}
            <button onClick={handleExportPdf} className="export-pdf" disabled={isExporting}>
              {isExporting ? 'Exporting…' : 'Export to PDF'}
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
      <div className="editor-area">
        {/* #8: onMouseUp removed from here — now on window */}
        <div 
          className="content-wrapper"
          onMouseMove={handleMouseMove}
        >
          <div 
            className="markdown-input-container" 
            style={{ flexBasis: `${dividerPosition}%` }}
          >
            <textarea
              ref={textareaRef}
              className="markdown-input"
              value={markdownContent}
              onChange={handleContentChange}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              placeholder="Enter Markdown here..."
            />
          </div >
          
          {/* Resizable Divider — #1: uses isResizerDragging */}
          <div 
            className="resizer" 
            onMouseDown={() => setIsResizerDragging(true)}
          />

          {/* #6: Bidirectional scroll sync */}
          <div className="preview-area" ref={previewRef} onScroll={handlePreviewScroll}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;