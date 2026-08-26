/// <reference types="vite/client" />

// Declaramos las variables de entorno que usa el frontend para que TS las conozca.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;   // URL del backend en prod; vacío en dev (usa /api)
  readonly VITE_WA_NUMBER?: string; // número de WhatsApp de la pizzería
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}