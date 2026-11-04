import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { RealtimeProvider } from './lib/ws';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {import.meta.env.VITE_STATIC_DEMO === 'true' ? (
    <HashRouter>
      <AuthProvider>
        <RealtimeProvider>
          <App />
        </RealtimeProvider>
      </AuthProvider>
    </HashRouter>
    ) : (
    <BrowserRouter>
      <AuthProvider>
        <RealtimeProvider>
          <App />
        </RealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
    )}
  </React.StrictMode>,
);
