/** @type {import('tailwindcss').Config} */
// Tailwind escanea estos archivos y genera solo las clases de CSS que aparecen
// en ellos. Por eso "src/**" (todo nuestro código) y el index.html.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Una marca simple para la pizzería (rojo tomate + un acento).
        marca: {
          DEFAULT: "#c1121f",
          oscura: "#8b0000",
        },
      },
    },
  },
  plugins: [],
};