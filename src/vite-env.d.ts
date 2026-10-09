/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEED?: string;
  readonly VITE_PANEL?: string;
  readonly VITE_FINNHUB_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
