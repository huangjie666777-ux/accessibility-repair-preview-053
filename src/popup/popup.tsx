import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './popup.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Fragment>
      <App />
    </React.Fragment>
  </React.StrictMode>,
);
