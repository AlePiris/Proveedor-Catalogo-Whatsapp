// PostCSS es el procesador que aplica Tailwind y Autoprefixer.
// Tailwind transforma las clases utilitarias en CSS real; Autoprefixer agrega
// los prefijos de navegadores (-webkit-, -moz-) automáticamente.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};