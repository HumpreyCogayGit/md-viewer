import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { marked } from 'marked';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import './App.css';

pdfMake.vfs = pdfFonts.vfs;

function App() {
  const [theme, setTheme] = useState('dark');
  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'dark' ? 'light' : 'dark'));
  };
  const [markdownContent, setMarkdownContent] = useState('# Welcome to Speculo\n\nThis is a simple Markdown Viewer/Editor.\n\n## Features\n*   Markdown rendering\n*   Basic styling\n\nTry editing the content or loading a file!');
  const [fileName, setFileName] = useState('document.md');
  const [isDragging, setIsDragging] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // New state for sync feature
  const [dividerPosition, setDividerPosition] = useState(50); // Percentage for initial split
  const textareaRef = useRef(null);
  const previewRef = useRef(null);

  const handleScroll = useCallback(() => {
    if (!isSyncing || !textareaRef.current || !previewRef.current) return;
    
    const textarea = textareaRef.current;
    const preview = previewRef.current;
    
    // Synchronize vertical scroll
    preview.scrollTop = textarea.scrollTop;
    // Synchronize horizontal scroll (though less likely needed for MD)
    preview.scrollLeft = textarea.scrollLeft;
  }, [isSyncing]);

  const handleContentChange = (e) => {
    setMarkdownContent(e.target.value);
  };

  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setMarkdownContent(event.target.result);
        setFileName(file.name);
      };
      reader.readAsText(file);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const container = e.currentTarget; // Now listening on content-wrapper
    const containerRect = container.getBoundingClientRect();
    
    // Calculate new percentage position based on mouse X relative to the content wrapper
    let newX = e.clientX - containerRect.left;
    
    // Calculate the width of the input container based on its current flex basis percentage
    // This is tricky with pure CSS flexbox resizing, so we calculate based on the wrapper's width.
    let newPercentage = (newX / containerRect.width) * 100;
    
    // Clamp percentage between 10% and 90% to ensure both panes are visible
    newPercentage = Math.max(10, Math.min(90, newPercentage));
    
    setDividerPosition(newPercentage);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      const previewElement = previewRef.current;
      if (!previewElement) return;
      
      // Get the visible text content from the preview area
      const textToCopy = previewElement.innerText; 
      
      await navigator.clipboard.writeText(textToCopy);
      alert('Preview content copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  }, []);

  // Helper: convert marked inline tokens → pdfmake text array (bold, italic, code)
  const parseInline = (text) => {
    // Simple inline regex fallback for bold/italic/code
    const parts = [];
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|(.+?))/gs;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[2]) parts.push({ text: match[2], bold: true });
      else if (match[3]) parts.push({ text: match[3], italics: true });
      else if (match[4]) parts.push({ text: match[4], fontSize: 10, background: '#f5f5f5' }); // Removed font: 'Courier'
      else if (match[5]) parts.push({ text: match[5] });
    }
    return parts.length ? parts : [{ text }];
  };

  const handleExportPdf = useCallback(() => {
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

        case 'list':
          content.push({
            [token.ordered ? 'ol' : 'ul']: token.items.map((item) => ({
              text: parseInline(item.text),
              style: 'body',
            })),
            margin: [0, 0, 0, 8],
          });
          break;

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

        case 'blockquote':
          content.push({
            text: token.text.replace(/^>\s?/gm, ''),
            style: 'blockquote',
            margin: [12, 0, 0, 8],
          });
          break;

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
          // Build header row with bold styled cells
          const headerRow = token.header.map((cell) => ({
            text: cell.text,
            style: 'tableHeader',
            fillColor: '#f0f0f0',
          }));

          // Build body rows
          const bodyRows = token.rows.map((row) =>
            row.map((cell) => ({
              text: parseInline(cell.text),
              style: 'tableCell',
            }))
          );

          // Auto-distribute column widths evenly
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
        code: { font: 'Roboto', fontSize: 9.5, color: '#333' }, // Changed font to Roboto to match default
        blockquote: { fontSize: 11, italics: true, color: '#555' },
        tableHeader: { fontSize: 10, bold: true, color: '#111' },
        tableCell: { fontSize: 10, color: '#333', lineHeight: 1.4 },
      },
      pageMargins: [50, 50, 50, 50],
    };

    pdfMake
      .createPdf(docDefinition)
      .download(fileName.replace(/\.md$/, '') + '.pdf');
  }, [markdownContent, fileName]);

  return (
    <div className={`md-viewer-container ${theme}`}>
      <div className="sidebar">
        <button 
          onClick={toggleTheme} 
          className="theme-toggle"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
        <button 
          onClick={() => setIsSyncing(!isSyncing)} 
          className={`sync-toggle ${isSyncing ? 'active' : ''}`}
          aria-label={isSyncing ? "Sync Off" : "Sync On"}
        >
          {isSyncing ? 'Sync On' : 'Sync Off'}
        </button>
        <button 
          onClick={handleCopy} 
          className="copy-toggle"
          aria-label="Copy Preview Content"
        >
          Copy
        </button>
        <button 
          onClick={handleExportPdf} 
          className="export-toggle"
          aria-label="Export Preview to PDF"
        >
          Export PDF
        </button>
        <div 
          onDragOver={handleDragOver} 
          onDrop={handleFileDrop} 
          className="drop-zone"
        >
          <p>Drag & Drop .md file here</p>
        </div >
        <p>Viewing: {fileName}</p>
      </div >
      <div className="editor-area">
        <div 
          className="content-wrapper"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
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
              placeholder="Enter Markdown here..."
            />
          </div >
          
          {/* Resizable Divider */}
          <div 
            className="resizer" 
            onMouseDown={() => setIsDragging(true)}
          />

          <div className="preview-area" ref={previewRef}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;