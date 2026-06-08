/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clé d'accès Unsplash (https://unsplash.com/developers) — sélecteur de couvertures. */
  readonly VITE_UNSPLASH_ACCESS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
