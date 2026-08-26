import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { ProductoVendido } from "@/types";

export default function Analisis() {
  const [datos, setDatos] = useState<ProductoVendido[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .getMasVendidos(10)
      .then((d) => setDatos(d))
      .catch((e) => setError(e.message));
  }, []);

  // Para la barra: calculamos el ancho relativo al más vendido (para comparar visualmente).
  const maxCant = Math.max(1, ...datos.map((d) => d.cantidad_total));

  return (
    <div>
      <h2 className="font-bold mb-3">Lo más vendido (pedidos confirmados)</h2>
      {error && <p className="text-marca">{error}</p>}
      {datos.length === 0 && !error && (
        <p className="text-gray-500">
          Aún no hay pedidos confirmados. Cuando confirmes ventas acá aparecerán
          los productos más pedidos.
        </p>
      )}

      <div className="space-y-2">
        {datos.map((d, i) => (
          <div key={i} className="bg-white border rounded p-3">
            <div className="flex justify-between mb-1">
              <span className="font-semibold">{d.nombre}</span>
              <span className="text-sm">
                {d.cantidad_total} u. — ${d.ingreso_total.toLocaleString("es-AR")}
              </span>
            </div>
            {/* Barra proporcional a la cantidad vendida. */}
            <div className="bg-gray-100 rounded h-3 overflow-hidden">
              <div
                className="bg-marca h-3"
                style={{ width: `${(d.cantidad_total / maxCant) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}