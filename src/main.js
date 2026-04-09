import React from 'react';
import ReactDOM from 'react-dom/client';
import { html } from './jsx.js';
import { Providers } from './mainProviders.js';
import { App } from './App.js'; // ✅ IMPORT REAL APP

ReactDOM.createRoot(document.getElementById('root')).render(
  html`<${Providers}><${App} /></${Providers}>`
);