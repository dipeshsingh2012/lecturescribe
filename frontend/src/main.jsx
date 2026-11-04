import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import 'katex/dist/katex.min.css';
import 'katex/dist/contrib/copy-tex.mjs';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register LearnScribe PWA Service Worker in production/standalone browser environments
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Automatically check for worker updates on load to evict stale caches on mobile
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('PWA ServiceWorker registration failed:', err);
      });
  });

  // Automatically refresh when a newly activated service worker claims the page
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

// Fallback recovery for mobile browsers stuck with corrupted cache bundles
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const msg = event?.message || '';
    if (
      msg.includes('Unexpected token') ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Loading chunk')
    ) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          for (const reg of regs) reg.unregister();
        });
      }
      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const k of keys) caches.delete(k);
        });
      }
    }
  });
}

