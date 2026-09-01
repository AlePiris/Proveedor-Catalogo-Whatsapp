import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { EstadoPedido, PedidoItemInput, PedidoOut, TipoPago } from "@/types";

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

  async function guardarEdicion(
    p: PedidoOut,
    items: PedidoItemInput[],
    metodo_pago?: TipoPago
  ) {
    try {
      await api.admin.updatePedido(p.id, { items, metodo_pago });
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

// Fila del editor de items: un producto del catálogo (producto_id) o un ítem
// "Otro" que el dueño agrega a mano (nombre + precio, solo vive en este pedido).
// `key` es un id local solo para el key= de React, no viaja al backend.
interface ItemEdit {
  key: number;
  producto_id: number | null;
  nombre: string;
  precio: number; // en productos es informativo (el backend lo recalcula); en "Otro" lo edita el dueño
  // "" mientras el dueño borra el número para retipearlo; guardar exige >= 1
  // (una fila en 0 o vacía se entiende como "quitarla", igual que antes).
  cantidad: number | "";
  // Elecciones guardadas del combo (ej: Bebida -> 1 Coca, Empanadas -> 3 Carne
  // + 3 Queso). Se reenvían INTACTAS al guardar: el backend exige que la suma
  // del grupo dé exacto y no debe cambiar lo que el cliente eligió solo porque
  // el dueño corrigió una cantidad.
  elecciones?: { grupo: string; producto_id: number; nombre: string; cantidad: number }[] | null;
}

// El input se puede borrar del todo mientras se retipea: "" queda en el
// estado; el guardar lo trata como "cantidad inválida" (no se manda al backend).
const leerCantidad = (v: string): number | "" => {
  if (v === "") return "";
  const n = parseInt(v);
  return isNaN(n) ? "" : n;
};

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
  onGuardar: (p: PedidoOut, items: PedidoItemInput[], metodo_pago?: TipoPago) => void;
  onConfirmar: (p: PedidoOut) => void;
  onCancelar: (p: PedidoOut) => void;
}) {
  // Editor: copia local de los items, editable (cambios de cantidad, quitar
  // filas y agregar ítems "Otro"). Recién al "Guardar cambios" viaja al backend,
  // que rehace la lista completa y recalcula el total.
  const [itemsEdit, setItemsEdit] = useState<ItemEdit[]>([]);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  // El método de pago también es corregible en edición (por WA suele cambiar).
  const [metodoPagoEdit, setMetodoPagoEdit] = useState<TipoPago>(pedido.metodo_pago);

  // Helper para editar una fila inmersivamente sin repetir el map a mano.
  function editarFila(key: number, cambio: (f: ItemEdit) => ItemEdit) {
    setItemsEdit((filas) => filas.map((f) => (f.key === key ? cambio(f) : f)));
  }

  // Inicializa el editor al entrar en edición.
  useEffect(() => {
    if (editando) {
      setItemsEdit(
        pedido.items.map((it) => ({
          key: it.id,
          producto_id: it.producto_id,
          nombre: it.nombre,
          precio: it.precio_unitario,
          cantidad: it.cantidad,
          elecciones: it.elecciones ?? null,
        }))
      );
      setMetodoPagoEdit(pedido.metodo_pago);
      setErrorEdicion(null);
    }
  }, [editando, pedido.items, pedido.metodo_pago]);

  // Total "en vivo" del editor (el definitivo lo recalcula el backend).
  // Cantidad vacía ("") aporta 0 hasta que se complete.
  const totalEdicion = itemsEdit.reduce(
    (s, f) => s + (typeof f.cantidad === "number" ? f.cantidad : 0) * f.precio,
    0
  );

  function agregarOtro() {
    setErrorEdicion(null);
    setItemsEdit((filas) => [
      ...filas,
      { key: -Date.now(), producto_id: null, nombre: "", precio: 0, cantidad: 1 },
    ]);
  }

  // Arma el payload y guarda. Validaciones acá para feedback inmediato
  // (el backend revalida igual: nombre y precio para los "Otro").
  // Una fila con cantidad vacía no se manda: igual que 0, se interpreta
  // como "quitarla del pedido".
  function guardarCambios() {
    const filas = itemsEdit.filter(
      (f): f is ItemEdit & { cantidad: number } =>
        typeof f.cantidad === "number" && f.cantidad > 0
    );
    const otraInvalida = filas.some((f) => !f.producto_id && (!f.nombre.trim() || f.precio < 0));
    if (otraInvalida) {
      setErrorEdicion('Cada ítem "Otro" necesita nombre y precio (el precio puede ser 0).');
      return;
    }
    if (filas.length === 0) {
      setErrorEdicion("El pedido no puede quedar sin items.");
      return;
    }
    onGuardar(
      pedido,
      filas.map((f) =>
        f.producto_id
          ? { producto_id: f.producto_id, cantidad: f.cantidad, elecciones: f.elecciones ?? null }
          : { nombre: f.nombre.trim(), precio_unitario: f.precio, cantidad: f.cantidad }
      ),
      metodoPagoEdit
    );
  }

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
          {/* Tipo de entrega: si es delivery, el dueño necesita ver A DONDE ir. */}
          {pedido.tipo_entrega === "delivery" ? (
            <p className="text-sm text-marca font-semibold">🛵 Delivery — {pedido.direccion}</p>
          ) : (
            <p className="text-sm text-gray-500">🏪 Take away</p>
          )}
          {/* Método de pago elegido por el cliente (cobro coordinado por WhatsApp). */}
          <p className="text-sm text-gray-500">
            {pedido.metodo_pago === "mercado_pago" ? "📱 Paga con Mercado Pago" : "💵 Paga en efectivo"}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${colorEstado}`}>
          {pedido.estado}
        </span>
      </div>

      {/* Items: en edición son filas editables (cantidades, quitar, "Otro");
          en vista normal, lista plana de snapshot. */}
      {editando ? (
        <ul className="text-sm space-y-2 mb-2">
          {itemsEdit.map((f) => (
            <li key={f.key} className="flex items-center gap-2">
              {f.producto_id ? (
                // Producto del catálogo: solo se edita cantidad. El precio
                // vigente lo vuelve a tomar el backend al guardar.
                <>
                  <span className="flex-1 min-w-0">
                    {f.nombre}{" "}
                    <span className="text-gray-400">
                      (${f.precio.toLocaleString("es-AR")} c/u)
                    </span>
                    {/* Las elecciones del cliente se conservan (no se editan
                        acá): cambiar qué bebida pidió el cliente es rehacer
                        el pedido, no corregirlo. */}
                    {(f.elecciones?.length ?? 0) > 0 && (
                      <span className="text-marca text-xs font-medium">
                        {" "}
                        ({f.elecciones!.map((e) =>
                          `${e.grupo}: ${e.cantidad !== 1 ? `${e.cantidad}× ` : ""}${e.nombre}`
                        ).join("; ")})
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    min={0}
                    className="border rounded px-1 py-0.5 w-14"
                    value={f.cantidad}
                    onChange={(e) => editarFila(f.key, (x) => ({ ...x, cantidad: leerCantidad(e.target.value) }))}
                    aria-label={`Cantidad de ${f.nombre}`}
                  />
                  <span className="w-20 text-right">
                    ${((typeof f.cantidad === "number" ? f.cantidad : 0) * f.precio).toLocaleString("es-AR")}
                  </span>
                  <button
                    onClick={() => setItemsEdit((fs) => fs.filter((x) => x.key !== f.key))}
                    className="text-marca text-xs hover:underline shrink-0"
                  >
                    Quitar
                  </button>
                </>
              ) : (
                // Ítem "Otro": nombre y precio editables a mano.
                <>
                  <input
                    className="border rounded px-1 py-0.5 flex-1 min-w-0"
                    placeholder='Nombre del extra (ej. "bacon extra")'
                    value={f.nombre}
                    onChange={(e) => editarFila(f.key, (x) => ({ ...x, nombre: e.target.value }))}
                  />
                  <div className="relative shrink-0">
                    <span className="absolute left-1.5 top-0.5 text-gray-400 text-xs">$</span>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      className="border rounded px-1 py-0.5 w-20 pl-4"
                      value={f.precio}
                      onChange={(e) => editarFila(f.key, (x) => ({ ...x, precio: parseFloat(e.target.value) || 0 }))}
                      aria-label="Precio del extra"
                    />
                  </div>
                  <input
                    type="number"
                    min={0}
                    className="border rounded px-1 py-0.5 w-14"
                    value={f.cantidad}
                    onChange={(e) => editarFila(f.key, (x) => ({ ...x, cantidad: leerCantidad(e.target.value) }))}
                    aria-label="Cantidad del extra"
                  />
                  <span className="w-20 text-right">
                    ${((typeof f.cantidad === "number" ? f.cantidad : 0) * f.precio).toLocaleString("es-AR")}
                  </span>
                  <button
                    onClick={() => setItemsEdit((fs) => fs.filter((x) => x.key !== f.key))}
                    className="text-marca text-xs hover:underline shrink-0"
                  >
                    Quitar
                  </button>
                </>
              )}
            </li>
          ))}

          {/* Botón que crea la fila "Otro" vacía. */}
          <li>
            <button
              onClick={agregarOtro}
              className="text-sm text-blue-600 hover:underline font-semibold"
            >
              + Agregar "Otro"
            </button>
          </li>
        </ul>
      ) : (
        <ul className="text-sm space-y-1 mb-2">
          {pedido.items.map((it) => (
            <li key={it.id} className="flex justify-between">
              <span>
                {it.cantidad}x {it.nombre}
                {/* Qué eligió el cliente en los grupos del combo
                    ("Bebida: Coca 1.5L"): el dueño necesita saber qué entregar. */}
                {it.detalle && (
                  <span className="text-marca font-medium"> — {it.detalle}</span>
                )}
              </span>
              <span>${(it.cantidad * it.precio_unitario).toLocaleString("es-AR")}</span>
            </li>
          ))}
        </ul>
      )}

      {editando && errorEdicion && <p className="text-marca text-sm mb-2">{errorEdicion}</p>}

      {pedido.notas && (
        <p className="text-sm text-gray-600 italic mb-2">Notas: {pedido.notas}</p>
      )}

      <div className="flex justify-between items-center pt-2 border-t">
        {/* En edición mostramos el total "en vivo" del editor (el definitivo
            lo recalcula el backend al guardar). */}
        <span className="font-bold">
          {editando && totalEdicion !== pedido.total && (
            <span className="text-gray-400 line-through mr-2 text-sm">
              ${pedido.total.toLocaleString("es-AR")}
            </span>
          )}
          Total: ${(editando ? totalEdicion : pedido.total).toLocaleString("es-AR")}
        </span>

        {editando ? (
          <div className="flex items-center gap-2">
            {/* Corregir el método de pago sin tocar código (coordinado por WA). */}
            <select
              value={metodoPagoEdit}
              onChange={(e) => setMetodoPagoEdit(e.target.value as PedidoOut["metodo_pago"])}
              className="border rounded px-2 py-1 text-sm"
              aria-label="Método de pago"
            >
              <option value="efectivo">💵 Efectivo</option>
              <option value="mercado_pago">📱 Mercado Pago</option>
            </select>
            <button
              onClick={guardarCambios}
              className="bg-marca text-white px-3 py-1 rounded text-sm"
            >
              Guardar cambios
            </button>
          </div>
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