import React from 'react';
import ReactDOM from 'react-dom/client';
import { html } from './jsx.js';
import { Providers } from './mainProviders.js';
import { App } from './App.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  html`
    <${React.StrictMode}>
      <${Providers}>
        <${App} />
      </${Providers}>
    </${React.StrictMode}>
  `
);