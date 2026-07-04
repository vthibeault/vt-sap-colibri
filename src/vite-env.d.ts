/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAP_MODE?: string;
  readonly VITE_SAP_BASE_URL?: string;
  readonly VITE_SAP_USER?: string;
  readonly VITE_SAP_PASSWORD?: string;
  readonly VITE_SAP_CLIENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
