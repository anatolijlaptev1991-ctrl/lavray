import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './base.css';
import './app.css';
import App from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('LAVRay: #root container not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
