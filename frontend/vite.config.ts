import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Alias "@/" -> "src/". tsc lo resuelve por tsconfig (paths), pero el bundler
  // de Vite (Rollup) NO lee tsconfig, así que hay que declararlo acá también.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // host: true permite acceder desde fuera del contenedor (Docker).
    host: true,
    port: 5173,
    // Proxy: las llamadas del frontend a "/api/*" se redirigen al backend.
    // Así evitamos problemas de CORS en desarrollo y usamos URLs relativas.
    proxy: {
      "/api": {
        // En Docker, VITE_PROXY_TARGET apunta a http://backend:8000 (red interna).
        // Corriendo Vite suelto en tu máquina, cae a localhost:8800 (backend local).
        target: process.env.VITE_PROXY_TARGET || "http://localhost:8800",
        changeOrigin: true,
      },
      // Las imágenes subidas se sirven desde el backend en /uploads.
      "/uploads": {
        target: process.env.VITE_PROXY_TARGET || "http://localhost:8800",
        changeOrigin: true,
      },
    },
    // En Docker sobre Windows, el watcher de archivos a veces no detecta
    // cambios en el host. usePolling lo resuelve (lo activamos solo si estamos
    // en Docker, detectado por la presencia de VITE_PROXY_TARGET).
    watch: {
      usePolling: Boolean(process.env.VITE_PROXY_TARGET),
    },
  },
});