import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { BrandProvider } from './state/BrandContext';
import { SapProvider } from './state/SapContext';
import { AuthProvider } from './state/AuthContext';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <BrandProvider>
        <SapProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SapProvider>
      </BrandProvider>
    </BrowserRouter>
  </StrictMode>,
);
