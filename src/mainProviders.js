import React from 'react';
import { html } from './jsx.js';
import { StoreProvider } from './store.js';
import { ToastProvider } from './toast.js';

export function Providers({ children }) {
  return html`
    <${React.StrictMode}>
      <${StoreProvider}>
        <${ToastProvider}>
          ${children}
        </${ToastProvider}>
      </${StoreProvider}>
    </${React.StrictMode}>
  `;
}