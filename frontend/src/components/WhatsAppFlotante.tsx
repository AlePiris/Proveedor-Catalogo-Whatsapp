import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { LocalConfig } from "@/types";

// Botón flotante de WhatsApp: círculo verde fijo abajo a la derecha, presente
// en TODAS las páginas (se monta en App, al lado de las rutas). El número es
// el de la config del dueño (GET /api/config, lo edita en Ajustes); si no
// está, cae a VITE_WA_NUMBER — mismo criterio que el checkout. Sin número,
// no se renderiza.
export default function WhatsAppFlotante() {
  const [config, setConfig] = useState<LocalConfig | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  const waNumber = config?.whatsapp || import.meta.env.VITE_WA_NUMBER || "";
  if (!waNumber) return null;

  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escribinos por WhatsApp"
      className="group fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-[#25D366] hover:bg-[#1ebe57] text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
    >
      {/* Ícono oficial de WhatsApp como SVG inline (nada de Font Awesome). */}
      <svg viewBox="0 0 32 32" fill="currentColor" className="w-7 h-7" aria-hidden="true">
        <path d="M16.04 4c-6.63 0-12 5.36-12 11.97 0 2.11.55 4.17 1.6 5.99L4 28l6.2-1.62a12.1 12.1 0 0 0 5.84 1.5c6.63 0 12-5.36 12-11.97S22.67 4 16.04 4zm0 21.9c-1.98 0-3.92-.53-5.63-1.53l-.4-.24-3.79.99 1.01-3.7-.25-.4a9.9 9.9 0 0 1-1.52-5.26c0-5.5 4.49-9.97 10.03-9.97 2.68 0 5.2 1.04 7.08 2.93a9.82 9.82 0 0 1 2.93 7.05c0 5.5-4.49 9.96-10.46 9.96h.6zm5.5-7.4c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.49-.9-.79-1.5-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.15-.15.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.9 1.22 3.09c.15.2 2.1 3.2 5.1 4.49.71.3 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z" />
      </svg>

      {/* Tooltip (desktop): aparece a la izquierda del círculo al pasar el
          mouse, como el "Contactar a Administración" de la web de ejemplo. */}
      <span className="hidden sm:block absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap bg-negro text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-negro-borde opacity-0 pointer-events-none group-hover:opacity-100 transition">
        Escribinos por WhatsApp
      </span>
    </a>
  );
}