import React from 'react';
import ReactDOM from 'react-dom/client';
// Fonts are bundled locally: no request to Google Fonts.
import '@fontsource/assistant/400.css';
import '@fontsource/assistant/500.css';
import '@fontsource/assistant/600.css';
import '@fontsource/assistant/700.css';
import '@fontsource/caveat/600.css';
import App from './app/App.jsx';
import { registerServiceWorker } from './pwa/registerServiceWorker.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
