/** @type {import('tailwindcss').Config} */
// Tailwind escanea estos archivos y genera solo las clases de CSS que aparecen
// en ellos. Por eso "src/**" (todo nuestro código) y el index.html.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta sobre negro (docs/Colores.jpg): amarillo como acento principal,
        // texto blanco y negro para lo que va ENCIMA del amarillo.
        marca: {
          DEFAULT: "#FFD230", // amarillo
          clara: "#FFE58A",
          oscura: "#E6B800",
        },
        negro: {
          DEFAULT: "#0A0A0A", // fondo general
          panel: "#171717", // cards y paneles
          borde: "#2B2B2B",
        },
        acento: "#D93A3A", // rojo frutilla (solo errores y avisos puntuales)
      },
    },
  },
  plugins: [],
};