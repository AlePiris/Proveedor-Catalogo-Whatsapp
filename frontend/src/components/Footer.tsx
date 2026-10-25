// Footer con la info del local. La fuente de verdad es la config que edita el
// dueño en Ajustes (GET /api/config). Si algo quedó vacío, no se muestra esa
// línea (footer limpio mientras el dueño completa sus datos).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { LocalConfig } from "@/types";

export default function Footer() {
  const [config, setConfig] = useState<LocalConfig | null>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Antes de cargar/no carga: no renderiza nada (sin salto visual feo).
  if (!config) return null;

  return (
    <footer className="border-t border-negro-borde bg-negro mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-sm text-gray-400 grid gap-6 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            {/* Logo del local solo si el dueño subió imagen (imagen = interruptor),
                sobre chip blanco igual que en el Navbar. */}
            {config.logo_url && (
              <img
                src={config.logo_url}
                alt=""
                className="w-10 h-10 rounded-xl bg-white object-contain p-0.5 ring-1 ring-white/10"
              />
            )}
            <p className="font-display text-marca text-lg">{config.nombre}</p>
          </div>
          {config.descripcion && <p className="text-xs leading-relaxed">{config.descripcion}</p>}
        </div>
        <div className="space-y-1.5">
          {config.direccion && <p>📍 {config.direccion}</p>}
          {config.telefono && (
            <p>
              📞{" "}
              <a className="hover:text-marca transition-colors" href={`tel:${config.telefono.replace(/\s/g, "")}`}>
                {config.telefono}
              </a>
            </p>
          )}
          {config.horarios && <p>🕒 {config.horarios}</p>}
        </div>
        <div className="space-y-1.5">
          {config.radio_delivery_km > 0 && <p>🛵 Delivery hasta {config.radio_delivery_km} km a la redonda</p>}
          <Link to="/contacto" className="inline-block text-marca hover:underline font-semibold">
            Ver contacto y horarios →
          </Link>
        </div>
      </div>
    </footer>
  );
}