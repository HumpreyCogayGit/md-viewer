import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

function App() {
  const [markdownContent, setMarkdownContent] = useState('# Welcome to MDViewer\n\nThis is a simple Markdown viewer mimicking Obsidian.\n\n## Features\n*   Markdown rendering\n*   Basic styling\n\nTry editing the content or loading a file!');
  const [fileName, setFileName] = useState('document.md');
  const [isDragging, setIsDragging] = useState(false);
  const [dividerPosition, setDividerPosition] = useState(50); // Percentage for initial split

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

  return (
    <div className="md-viewer-container">
      <div className="sidebar">
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
              className="markdown-input"
              value={markdownContent}
              onChange={handleContentChange}
              placeholder="Enter Markdown here..."
            />
          </div >
          
          {/* Resizable Divider */}
          <div 
            className="resizer" 
            onMouseDown={() => setIsDragging(true)}
          />

          <div className="preview-area">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;