import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './mainProviders.jsx';
import { App } from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  (
    <React.StrictMode>
      <Providers>
        <App />
      </Providers>
    </React.StrictMode>
  )
);