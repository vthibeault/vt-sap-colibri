import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // nova-charts is vendored from source (see vendor/nova-charts/README.md).
      'nova-charts': fileURLToPath(new URL('./vendor/nova-charts/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // In live mode, proxy OData calls to the SAP gateway so the browser
    // never fights CORS. Set SAP_GATEWAY_URL when you have system access.
    proxy: process.env.SAP_GATEWAY_URL
      ? {
          '/sap/opu/odata': {
            target: process.env.SAP_GATEWAY_URL,
            changeOrigin: true,
            secure: true,
          },
        }
      : undefined,
  },
});
