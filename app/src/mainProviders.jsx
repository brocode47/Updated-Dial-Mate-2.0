import React from 'react';
import { StoreProvider } from './store.jsx';
import { ToastProvider } from './toast.jsx';

export function Providers({ children }) {
  return (
    <React.StrictMode>
      <StoreProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </StoreProvider>
    </React.StrictMode>
  );
}