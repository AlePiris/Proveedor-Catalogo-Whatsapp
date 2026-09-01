import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { ProductoVendido, VentaPorDia } from "@/types";

export default function Analisis() {
  const [datos, setDatos] = useState<ProductoVendido[]>([]);
  const [porDia, setPorDia] = useState<VentaPorDia[]>([]);
  const [dias, setDias] = useState(7);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .getMasVendidos(10)
      .then((d) => setDatos(d))
      .catch((e) => setError(e.message));
  }, []);

  // Ventas por día: se recarga al cambiar el selector de rango.
  useEffect(() => {
    api.admin
      .getVentasPorDia(dias)
      .then((d) => setPorDia(d))
      .catch((e) => setError(e.message));
  }, [dias]);

  // Para la barra: calculamos el ancho relativo al más vendido (para comparar visualmente).
  const maxCant = Math.max(1, ...datos.map((d) => d.cantidad_total));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-bold mb-3">Ventas por día (cuándo se compra más)</h2>
        {error && <p className="text-marca">{error}</p>}

        {/* Selector de rango: recarga la tabla de abajo. */}
        <div className="mb-3">
          <label className="text-sm text-gray-600 mr-2">Mostrar:</label>
          <select
            className="border rounded px-2 py-1"
            value={dias}
            onChange={(e) => setDias(parseInt(e.target.value))}
          >
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
          </select>
        </div>

        {/* Un renglón por día (incluye los días sin ventas, en cero). La
            barra es proporcional al ingreso del día: así el dueño ve de un
            vistazo los días fuertes y los flojos. */}
        <div className="space-y-2">
          {porDia.map((d) => (
            <div key={d.fecha} className="bg-white border rounded p-3">
              <div className="flex justify-between mb-1">
                <span className="font-semibold">{formatearDia(d.fecha)}</span>
                <span className="text-sm">
                  {d.pedidos} pedido(s) — {d.unidades} u. — $
                  {d.ingreso_total.toLocaleString("es-AR")}
                </span>
              </div>
              <div className="bg-gray-100 rounded h-3 overflow-hidden">
                <div
                  className="bg-marca h-3"
                  style={{ width: `${(d.ingreso_total / Math.max(1, ...porDia.map((x) => x.ingreso_total))) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {porDia.length > 0 && porDia.every((d) => d.pedidos === 0) && (
            <p className="text-gray-500">
              Sin ventas confirmadas en este rango. Confirmá pedidos desde la
              tab Pedidos para verlos acá.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-bold mb-3">Lo más vendido (pedidos confirmados)</h2>
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
      </section>
    </div>
  );
}

// "2026-08-31" -> "lun 31/08": día corto y fecha, fácil de leer en la lista.
function formatearDia(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const dia = dias[d.getDay()];
  const fecha = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  return `${dia} ${fecha}`;
}