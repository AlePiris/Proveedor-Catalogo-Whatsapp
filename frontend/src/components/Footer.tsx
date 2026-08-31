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
    <footer className="border-t bg-white mt-12">
      <div className="max-w-7xl mx-auto px-4 py-6 text-sm text-gray-600 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="font-bold text-gray-800 mb-1">🍕 {config.nombre}</p>
          {config.descripcion && <p className="text-xs">{config.descripcion}</p>}
        </div>
        <div className="space-y-1">
          {config.direccion && (
            <p>
              📍 {config.direccion}
            </p>
          )}
          {config.telefono && (
            <p>
              📞 <a className="hover:text-marca" href={`tel:${config.telefono.replace(/\s/g, "")}`}>{config.telefono}</a>
            </p>
          )}
          {config.horarios && <p>🕒 {config.horarios}</p>}
        </div>
        <div className="space-y-1">
          {config.radio_delivery_km > 0 && (
            <p>🛵 Delivery hasta {config.radio_delivery_km} km a la redonda</p>
          )}
          <Link to="/contacto" className="inline-block text-marca hover:underline">
            Ver contacto y horarios →
          </Link>
        </div>
      </div>
    </footer>
  );
}