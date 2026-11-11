/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_PROXY_TARGET?: string;
  readonly VITE_USE_POLLING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
