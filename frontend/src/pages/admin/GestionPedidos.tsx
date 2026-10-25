import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { EstadoPedido, PedidoItemInput, PedidoOut, TipoPago } from "@/types";
import { ConfirmModal } from "@/components/Modal";

export default function GestionPedidos() {
  const [pedidos, setPedidos] = useState<PedidoOut[]>([]);
  const [filtro, setFiltro] = useState<EstadoPedido | "todas">("pendiente");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pedido pendiente de CANCELAR (abre el ConfirmModal propio del tema).
  const [aPedirCancelar, setAPedirCancelar] = useState<PedidoOut | null>(null);

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
    setAPedirCancelar(p); // la confirmación vive en el ConfirmModal propio
  }

  async function confirmarCancelar(p: PedidoOut) {
    setAPedirCancelar(null);
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
              filtro === f ? "bg-marca text-black" : "bg-negro-panel border border-negro-borde text-gray-200 hover:bg-gray-800"
            }`}
          >
            {f === "todas" ? "Todas" : f}
          </button>
        ))}
      </div>

      {pedidos.length === 0 && <p className="text-gray-400">No hay pedidos en este estado.</p>}

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

      {aPedirCancelar && (
        <ConfirmModal
          titulo="Cancelar pedido"
          mensaje={`¿Cancelar el pedido de ${aPedirCancelar.cliente_nombre}? Si tenía combos, se reintegra el stock de lo elegido.`}
          textoConfirmar="Cancelar pedido"
          peligroso
          onConfirmar={() => confirmarCancelar(aPedirCancelar)}
          onCancelar={() => setAPedirCancelar(null)}
        />
      )}
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
  precio: number | ""; // en "Otro" lo edita el dueño; en catálogo, solo si NEGOCIA
  // Precio con el que el item llegó en el pedido (snapshot). Al guardar:
  // si `precio` sigue igual NO se manda precio_unitario y el backend
  // refresca el precio vigente del catálogo (como siempre); si cambió,
  // viaja y pisa SOLO este pedido (negociación por WhatsApp).
  precioOriginal: number;
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

// Igual que leerCantidad pero para el precio: si el dueño borra el número
// para retipearlo, el campo queda VACÍO (no se rellena con 0, que era lo
// que pegaba el número nuevo atrás del cero: "0" + "15000" = "015000").
const leerPrecio = (v: string): number | "" => {
  if (v === "") return "";
  const n = parseFloat(v);
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
          precioOriginal: it.precio_unitario,
          cantidad: it.cantidad,
          elecciones: it.elecciones ?? null,
        }))
      );
      setMetodoPagoEdit(pedido.metodo_pago);
      setErrorEdicion(null);
    }
  }, [editando, pedido.items, pedido.metodo_pago]);

  // Total "en vivo" del editor (el definitivo lo recalcula el backend).
  // Cantidad o precio vacíos ("") aportan 0 hasta que se completen.
  const totalEdicion = itemsEdit.reduce(
    (s, f) =>
      s +
      (typeof f.cantidad === "number" ? f.cantidad : 0) *
        (typeof f.precio === "number" ? f.precio : 0),
    0
  );

  function agregarOtro() {
    setErrorEdicion(null);
    setItemsEdit((filas) => [
      ...filas,
      { key: -Date.now(), producto_id: null, nombre: "", precio: "", precioOriginal: 0, cantidad: 1 },
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
    // Precio vacío ("") = edición de precio a medias. En "Otro" es inválido
    // (necesita precio); en catálogo se interpreta como "no lo cambió" (no
    // viaja precio_unitario y el backend refresca el vigente), así un
    // guardado apurado no congela un precio que el dueño ni escribió.
    const otraInvalida = filas.some(
      (f) => !f.producto_id && (!f.nombre.trim() || f.precio === "" || f.precio < 0)
    );
    if (otraInvalida) {
      setErrorEdicion('Cada ítem "Otro" necesita nombre y precio (el precio puede ser 0).');
      return;
    }
    if (filas.some((f) => f.producto_id && typeof f.precio === "number" && f.precio < 0)) {
      setErrorEdicion("El precio negociado no puede ser negativo.");
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
          ? {
              producto_id: f.producto_id,
              cantidad: f.cantidad,
              elecciones: f.elecciones ?? null,
              // Precio NEGOCIADO: solo viaja si el dueño lo cambió (y lo
              // completó). Si no, el backend vuelve a snapshotear el precio
              // VIGENTE (por si el catálogo cambió desde que el cliente pidió).
              ...(typeof f.precio === "number" && f.precio !== f.precioOriginal
                ? { precio_unitario: f.precio }
                : {}),
            }
          // La validación de arriba ya rechazó los "Otro" con precio vacío;
          // el 0 solo satisface al compilador, nunca se ejecuta.
          : {
              nombre: f.nombre.trim(),
              precio_unitario: typeof f.precio === "number" ? f.precio : 0,
              cantidad: f.cantidad,
            }
      ),
      metodoPagoEdit
    );
  }

  const colorEstado =
    pedido.estado === "confirmada" ? "bg-green-500/15 text-green-400"
    : pedido.estado === "cancelada" ? "bg-gray-700 text-gray-300"
    : "bg-marca/15 text-marca";

  return (
    <div className="bg-negro-panel border border-negro-borde rounded-lg p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="font-bold">#{pedido.id} — {pedido.cliente_nombre}</p>
          {/* Los pedidos nuevos no traen teléfono (el contacto es WhatsApp);
              solo se muestra si el pedido lo tiene (datos viejos o el dueño lo cargó). */}
          {pedido.telefono && <p className="text-sm text-gray-400">📞 {pedido.telefono}</p>}
          {/* Tipo de entrega: si es delivery, el dueño necesita ver A DONDE ir. */}
          {pedido.tipo_entrega === "delivery" ? (
            <p className="text-sm text-marca font-semibold">🛵 Delivery — {pedido.direccion}</p>
          ) : (
            <p className="text-sm text-gray-400">🏪 Take away</p>
          )}
          {/* Método de pago elegido por el cliente (cobro coordinado por WhatsApp). */}
          <p className="text-sm text-gray-400">
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
                // Producto del catálogo: se edita cantidad y, si el dueño
                // NEGOCIÓ otro precio por WhatsApp, también el precio (pisará
                // el snapshot SOLO de este pedido; el catálogo queda intacto).
                <>
                  <span className="flex-1 min-w-0">
                    {f.nombre}{" "}
                    {/* Precio por unidad editable. Resaltado cuando difiere
                        del original; ↺ lo restaura. Si se deja igual, al
                        guardar el backend refresca el precio vigente. */}
                    <span className="inline-flex items-center gap-0.5">
                      <span
                        className={`text-xs ${
                          f.precio !== f.precioOriginal ? "text-marca font-bold" : "text-gray-400"
                        }`}
                      >
                        $
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="1"
                        className={`border-negro-borde bg-negro text-gray-100 rounded px-1 py-0.5 w-20 ${
                          typeof f.precio === "number" && f.precio !== f.precioOriginal ? "border-marca" : ""
                        }`}
                        value={f.precio}
                        placeholder="0"
                        onChange={(e) =>
                          editarFila(f.key, (x) => ({ ...x, precio: leerPrecio(e.target.value) }))
                        }
                        aria-label={`Precio unitario de ${f.nombre}`}
                      />
                      {typeof f.precio === "number" && f.precio !== f.precioOriginal && (
                        <button
                          onClick={() =>
                            editarFila(f.key, (x) => ({ ...x, precio: x.precioOriginal }))
                          }
                          className="text-gray-400 hover:text-gray-200 text-xs"
                          title="Restaurar precio del pedido"
                        >
                          ↺
                        </button>
                      )}
                    </span>
                    {" "}c/u
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
                    className="border-negro-borde bg-negro text-gray-100 rounded px-1 py-0.5 w-14"
                    value={f.cantidad}
                    onChange={(e) => editarFila(f.key, (x) => ({ ...x, cantidad: leerCantidad(e.target.value) }))}
                    aria-label={`Cantidad de ${f.nombre}`}
                  />
                  <span className="w-20 text-right">
                    ${((typeof f.cantidad === "number" ? f.cantidad : 0) *
                      (typeof f.precio === "number" ? f.precio : 0)).toLocaleString("es-AR")}
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
                    className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-500 rounded px-1 py-0.5 flex-1 min-w-0"
                    placeholder=""
                    value={f.nombre}
                    onChange={(e) => editarFila(f.key, (x) => ({ ...x, nombre: e.target.value }))}
                  />
                  <div className="relative shrink-0">
                    <span className="absolute left-1.5 top-0.5 text-gray-400 text-xs">$</span>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      className="border-negro-borde bg-negro text-gray-100 rounded px-1 py-0.5 w-20 pl-4"
                      value={f.precio}
                      placeholder="0"
                      onChange={(e) => editarFila(f.key, (x) => ({ ...x, precio: leerPrecio(e.target.value) }))}
                      aria-label="Precio del extra"
                    />
                  </div>
                  <input
                    type="number"
                    min={0}
                    className="border-negro-borde bg-negro text-gray-100 rounded px-1 py-0.5 w-14"
                    value={f.cantidad}
                    onChange={(e) => editarFila(f.key, (x) => ({ ...x, cantidad: leerCantidad(e.target.value) }))}
                    aria-label="Cantidad del extra"
                  />
                  <span className="w-20 text-right">
                    ${((typeof f.cantidad === "number" ? f.cantidad : 0) *
                      (typeof f.precio === "number" ? f.precio : 0)).toLocaleString("es-AR")}
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
              className="text-sm text-blue-400 hover:underline font-semibold"
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
        <p className="text-sm text-gray-300 italic mb-2">Notas: {pedido.notas}</p>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-negro-borde">
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
              className="border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 text-sm"
              aria-label="Método de pago"
            >
              <option value="efectivo">💵 Efectivo</option>
              <option value="mercado_pago">📱 Mercado Pago</option>
            </select>
            <button
              onClick={guardarCambios}
              className="bg-marca text-black px-3 py-1 rounded text-sm"
            >
              Guardar cambios
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {pedido.estado === "pendiente" && (
              <>
                <button onClick={onEditar} className="text-sm text-blue-400 hover:underline">Editar</button>
                <button onClick={() => onConfirmar(pedido)} className="text-sm text-green-400 hover:underline font-semibold">Confirmar</button>
                <button onClick={() => onCancelar(pedido)} className="text-sm text-gray-400 hover:underline">Cancelar</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}