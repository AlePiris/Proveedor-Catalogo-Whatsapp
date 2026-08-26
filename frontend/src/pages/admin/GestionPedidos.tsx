import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { EstadoPedido, PedidoOut } from "@/types";

export default function GestionPedidos() {
  const [pedidos, setPedidos] = useState<PedidoOut[]>([]);
  const [filtro, setFiltro] = useState<EstadoPedido | "todas">("pendiente");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    try {
      // Si filtro es "todas" no mandamos ?estado (trae todo).
      setPedidos(await api.admin.getPedidos(filtro === "todas" ? undefined : filtro));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  async function confirmar(p: PedidoOut) {
    try {
      await api.admin.confirmarPedido(p.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function cancelar(p: PedidoOut) {
    if (!confirm("¿Cancelar este pedido?")) return;
    try {
      await api.admin.cancelarPedido(p.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarEdicion(p: PedidoOut, items: { producto_id: number; cantidad: number }[]) {
    try {
      await api.admin.updatePedido(p.id, { items });
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-marca">{error}</p>}

      {/* Filtros por estado */}
      <div className="flex gap-2">
        {(["pendiente", "confirmada", "cancelada", "todas"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1 rounded text-sm capitalize ${
              filtro === f ? "bg-marca text-white" : "bg-white border"
            }`}
          >
            {f === "todas" ? "Todas" : f}
          </button>
        ))}
      </div>

      {pedidos.length === 0 && <p className="text-gray-500">No hay pedidos en este estado.</p>}

      {pedidos.map((p) => (
        <PedidoCard
          key={p.id}
          pedido={p}
          editando={editandoId === p.id}
          onEditar={() => setEditandoId(p.id)}
          onGuardar={guardarEdicion}
          onConfirmar={confirmar}
          onCancelar={cancelar}
        />
      ))}
    </div>
  );
}

// Tarjeta de un pedido. Cuando se edita, muestra inputs de cantidad por item.
function PedidoCard({
  pedido,
  editando,
  onEditar,
  onGuardar,
  onConfirmar,
  onCancelar,
}: {
  pedido: PedidoOut;
  editando: boolean;
  onEditar: () => void;
  onGuardar: (p: PedidoOut, items: { producto_id: number; cantidad: number }[]) => void;
  onConfirmar: (p: PedidoOut) => void;
  onCancelar: (p: PedidoOut) => void;
}) {
  // Cantidad editada por item (solo para items con producto_id, los nuevos no se
  // pueden agregar acá para mantenerlo simple: el dueño ajusta cantidades).
  const [cantidades, setCantidades] = useState<Record<number, number>>({});

  // Inicializa las cantidades al entrar en edición.
  useEffect(() => {
    if (editando) {
      const c: Record<number, number> = {};
      pedido.items.forEach((it) => { if (it.producto_id) c[it.producto_id] = it.cantidad; });
      setCantidades(c);
    }
  }, [editando, pedido.items]);

  const colorEstado =
    pedido.estado === "confirmada" ? "bg-green-100 text-green-700"
    : pedido.estado === "cancelada" ? "bg-gray-200 text-gray-600"
    : "bg-yellow-100 text-yellow-700";

  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-bold">#{pedido.id} — {pedido.cliente_nombre}</p>
          <p className="text-sm text-gray-500">📞 {pedido.telefono}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${colorEstado}`}>
          {pedido.estado}
        </span>
      </div>

      {/* Items */}
      <ul className="text-sm space-y-1 mb-2">
        {pedido.items.map((it) => (
          <li key={it.id} className="flex justify-between">
            {editando && it.producto_id ? (
              <span className="flex items-center gap-2">
                {it.nombre}
                <input
                  type="number"
                  className="border rounded px-1 py-0.5 w-16"
                  value={cantidades[it.producto_id] ?? it.cantidad}
                  onChange={(e) =>
                    setCantidades({ ...cantidades, [it.producto_id!]: parseInt(e.target.value) || 0 })
                  }
                />
              </span>
            ) : (
              <span>{it.cantidad}x {it.nombre}</span>
            )}
            <span>${(it.cantidad * it.precio_unitario).toLocaleString("es-AR")}</span>
          </li>
        ))}
      </ul>

      {pedido.notas && (
        <p className="text-sm text-gray-600 italic mb-2">Notas: {pedido.notas}</p>
      )}

      <div className="flex justify-between items-center pt-2 border-t">
        <span className="font-bold">Total: ${pedido.total.toLocaleString("es-AR")}</span>

        {editando ? (
          <button
            onClick={() =>
              onGuardar(
                pedido,
                pedido.items
                  .filter((it) => it.producto_id)
                  .map((it) => ({
                    producto_id: it.producto_id!,
                    cantidad: cantidades[it.producto_id!] ?? it.cantidad,
                  }))
              )
            }
            className="bg-marca text-white px-3 py-1 rounded text-sm"
          >
            Guardar cambios
          </button>
        ) : (
          <div className="flex gap-2">
            {pedido.estado === "pendiente" && (
              <>
                <button onClick={onEditar} className="text-sm text-blue-600 hover:underline">Editar</button>
                <button onClick={() => onConfirmar(pedido)} className="text-sm text-green-600 hover:underline font-semibold">Confirmar</button>
                <button onClick={() => onCancelar(pedido)} className="text-sm text-gray-500 hover:underline">Cancelar</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}