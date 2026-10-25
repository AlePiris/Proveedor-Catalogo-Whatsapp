// Página de contacto: muestra TODO lo que el dueño carga en Ajustes
// (dirección, teléfono, WhatsApp, horarios, radio de delivery, descripción).
// Es pública: cualquier visitante la puede abrir desde el Navbar o el footer.
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { LocalConfig } from "@/types";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default function Contacto() {
  const [config, setConfig] = useState<LocalConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="min-h-full bg-negro flex flex-col">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 py-10 flex-1 w-full">
        <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-tight text-gray-100 mb-6">
          Contacto
        </h1>

        {error && <p className="text-marca">Error: {error}</p>}
        {!config && !error && <p className="text-gray-300">Cargando…</p>}

        {config && (
          <div className="bg-negro-panel border border-negro-borde rounded-xl shadow-card p-6 space-y-4">
            <div className="flex items-center gap-3">
              {config.logo_url && (
                <img
                  src={config.logo_url}
                  alt=""
                  className="w-12 h-12 rounded-xl bg-white object-contain p-0.5 ring-1 ring-white/10"
                />
              )}
              <div>
                <h2 className="font-display text-xl text-marca">{config.nombre}</h2>
                {config.descripcion && <p className="text-gray-400 mt-0.5">{config.descripcion}</p>}
              </div>
            </div>

            <ul className="space-y-3 text-gray-200">
              {config.direccion && (
                <li className="flex items-start gap-2">
                  <span aria-hidden>📍</span>
                  <span>{config.direccion}</span>
                </li>
              )}
              {config.telefono && (
                <li className="flex items-center gap-2">
                  <span aria-hidden>📞</span>
                  {/* tel: abre el discado en mobile; sacamos espacios para el href */}
                  <a
                    className="hover:text-marca"
                    href={`tel:${config.telefono.replace(/\s/g, "")}`}
                  >
                    {config.telefono}
                  </a>
                </li>
              )}
              {config.whatsapp && (
                <li className="flex items-center gap-2">
                  <span aria-hidden>💬</span>
                  <a
                    className="hover:text-marca"
                    href={`https://wa.me/${config.whatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Escribinos por WhatsApp
                  </a>
                </li>
              )}
              {config.horarios && (
                <li className="flex items-center gap-2">
                  <span aria-hidden>🕒</span>
                  <span>{config.horarios}</span>
                </li>
              )}
            </ul>

            {/* Radio de delivery configurado por el dueño (informativo). */}
            <div className="border-t border-negro-borde pt-4">
              {config.radio_delivery_km > 0 ? (
                <p className="text-sm text-gray-300">
                  🛵 <strong>Hacemos delivery hasta {config.radio_delivery_km} km</strong> a la
                  redonda del local. El alcance exacto lo confirmamos por WhatsApp.
                </p>
              ) : (
                <p className="text-sm text-gray-400">
                  Por ahora no ofrecemos delivery. Podés retirar tu pedido en el local.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}