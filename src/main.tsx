import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { BrandProvider } from './state/BrandContext';
import { SapProvider } from './state/SapContext';
import { AuthProvider } from './state/AuthContext';
import { I18nProvider } from './i18n';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <BrandProvider>
        <I18nProvider>
          <SapProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </SapProvider>
        </I18nProvider>
      </BrandProvider>
    </BrowserRouter>
  </StrictMode>,
);
