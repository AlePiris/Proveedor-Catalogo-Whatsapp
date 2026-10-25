/** @type {import('tailwindcss').Config} */
// Tailwind escanea estos archivos y genera solo las clases de CSS que aparecen
// en ellos. Por eso "src/**" (todo nuestro código) y el index.html.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Tipografц╜a de marca (cargadas desde Google Fonts, ver index.html):
      //  - font-display: Archivo Black — títulos gruesos estilo deportivo,
      //    el "más fuerte" de la paleta Vitalgy.
      //  - font-sans: Manrope — texto limpio y amable (a tono con el logo).
      fontFamily: {
        display: ['"Archivo Black"', "system-ui", "sans-serif"],
        sans: ['"Manrope"', "system-ui", "sans-serif"],
      },
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
          sub: "#1F1F1F", // superficies elevadas (hover dentro de un panel)
          borde: "#2B2B2B",
        },
        acento: "#D93A3A", // rojo frutilla (solo errores y avisos puntuales)
      },
      // Elevaciones de la marca: una sombra suave para panels y un glow
      // amarillo para botones/acentos importantes.
      boxShadow: {
        card: "0 2px 10px rgba(0,0,0,0.35)",
        glow: "0 0 24px rgba(255,210,48,0.22)",
      },
    },
  },
  plugins: [],
};