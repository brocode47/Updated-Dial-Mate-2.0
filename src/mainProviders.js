/* __imports_rewritten__ */
import React from 'react';
import { html } from './jsx.js';
import { StoreProvider } from './store.js';
import { ToastProvider } from './toast.js';

export function Providers(props) {
  return html`
    <${StoreProvider}>
      <${ToastProvider}>${props.children}</${ToastProvider}>
    </${StoreProvider}>
  `;
}