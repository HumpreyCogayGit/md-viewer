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
  const [copyStatus, setCopyStatus] = useState(''); // State for copy confirmation message
  const [dividerPosition, setDividerPosition] = useState(50); // Percentage for initial split
  const textareaRef = useRef(null);
  const previewRef = useRef(null);

  // Calculate word and character counts whenever markdownContent changes
  const { wordCount, charCount } = (() => {
    const text = markdownContent;
    const charCount = text.length;
    // Simple word count: split by whitespace and filter out empty strings
    const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    return { wordCount, charCount };
  })();

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

  // Feature 2: Handle Tab key press
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const value = e.target.value;
      
      // Insert 4 spaces for indentation
      const newText = value.substring(0, start) + '    ' + value.substring(end);
      
      e.target.value = newText;
      
      // Move cursor past the inserted spaces
      e.target.selectionStart = e.target.selectionEnd = start + 4;
      
      setMarkdownContent(newText);
    }
  }, []);

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
    setIsDragging(true); // Feature 3: Set dragging state
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
    setIsDragging(false); // Feature 3: Clear dragging state
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

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.md')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setMarkdownContent(event.target.result);
        setFileName(file.name);
      };
      reader.readAsText(file);
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
        {/* Middle: Fixed Drop Zone */}
        <div 
          onDragOver={handleDragOver} 
          onDrop={handleFileDrop} 
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onClick={() => document.getElementById('file-input').click()}
        >
          <p>Drag & Drop or Click to load .md</p>
        </div>
        {/* Left: Buttons + Status */}
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
            <button onClick={handleExportPdf} className="export-pdf">Export to PDF</button>
          </div>

          {/* Message area with fixed height to prevent layout shifting */}
          <div className="copy-status-message">
            {copyStatus && (
              <span style={{ color: copyStatus.includes('Failed') ? '#ff6b6b' : '#51cf66' }}>
                {copyStatus}
              </span>
            )}
          </div>
        </div>

        

        <input type="file" id="file-input" accept=".md" onChange={handleFileSelect} style={{ display: 'none' }} />

        {/* Right: File Info */}
        <div className="file-info">
          <p style={{margin: 0}}><strong>{fileName}</strong></p>
          <p className="word-count" style={{margin: 0, opacity: 0.7}}>
            {wordCount} words | {charCount} chars
          </p>
        </div>
      </div>
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
              onKeyDown={handleKeyDown}
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