import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useCart } from "@/context/CartContext";
import { precioEfectivo, textoElecciones, type LocalConfig, type TipoEntrega, type TipoPago } from "@/types";
import Navbar from "@/components/Navbar";

export default function Carrito() {
  const { items, setCantidad, remove, total, clear } = useCart();
  const navigate = useNavigate();

  // Datos del cliente que pide. El teléfono coincide con el que usará en WhatsApp.
  const [clienteNombre, setClienteNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");
  // Entrega: por defecto retira en el local. Si el dueño deshabilitó el delivery
  // (radio 0 en Ajustes), el selector de delivery queda bloqueado.
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega>("takeaway");
  const [direccion, setDireccion] = useState("");
  // Pago: se coordina por WhatsApp (no hay cobro online). Queda registrado
  // para que el dueño prepare el cambio o mande el link de Mercado Pago.
  const [metodoPago, setMetodoPago] = useState<TipoPago>("efectivo");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config del local: radio de delivery y (si el dueño lo cargó) el número de
  // WhatsApp que recibe los pedidos. Con esto el dueño controla TODO sin tocar
  // código ni variables de entorno.
  const [config, setConfig] = useState<LocalConfig | null>(null);
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Radio > 0 => delivery habilitado. Mientras no cargue la config (null),
  // tratamos como "sin delivery" para no prometer algo que no existe.
  const deliveryHabilitado = (config?.radio_delivery_km ?? 0) > 0;

  // Número de WhatsApp: prioriza el de la config del dueño; fallback a la var
  // de entorno (comportamiento original). "0" = inválido => solo se guarda el pedido.
  const waNumber = config?.whatsapp || import.meta.env.VITE_WA_NUMBER || "0";

  async function enviarPedido() {
    setError(null);
    if (!clienteNombre.trim() || !telefono.trim()) {
      setError("Completa tu nombre y teléfono.");
      return;
    }
    if (tipoEntrega === "delivery" && !direccion.trim()) {
      setError("Si elegís delivery, necesitamos tu dirección.");
      return;
    }
    if (items.length === 0) return;

    setEnviando(true);
    try {
      // 1) GUARDAMOS el pedido en la base de datos (estado "pendiente").
      //    El backend calcula el total y hace el snapshot de precios.
      const pedido = await api.createPedido({
        cliente_nombre: clienteNombre.trim(),
        telefono: telefono.trim(),
        tipo_entrega: tipoEntrega,
        direccion: tipoEntrega === "delivery" ? direccion.trim() : null,
        metodo_pago: metodoPago,
        notas: notas.trim() || null,
        items: items.map((i) => ({
          producto_id: i.producto.id,
          cantidad: i.cantidad,
          // Solo los combos con grupos traen elecciones; el backend las valida.
          elecciones: i.elecciones ?? null,
        })),
      });

      // 2) ARMAMOS el mensaje de WhatsApp con el #ID del pedido.
      //    En los combos, cada línea incluye qué eligió el cliente en cada
      //    grupo (ej: "Bebida: Coca 1.5L"), para que el dueño sepa qué entregar.
      const lineas = items
        .map((i) => {
          const detalle = textoElecciones(i.producto, i.elecciones);
          return (
            `• ${i.cantidad}x ${i.producto.nombre}${detalle ? ` (${detalle})` : ""} — $${precioEfectivo(
              i.producto
            ).toLocaleString("es-AR")} c/u`
          );
        })
        .join("\n");
      const entrega =
        tipoEntrega === "delivery" ? `🛵 Delivery — ${direccion.trim()}` : "🏪 Take away (retira en el local)";
      const pago = metodoPago === "mercado_pago" ? "📱 Mercado Pago" : "💵 Efectivo";
      // Sin el # de pedido: el ID queda en la base (dashboard), el texto de
      // WhatsApp es solo la info que el dueño necesita para armar el pedido.
      const mensaje =
        `*Nuevo pedido* 🍕\n` +
        `Cliente: ${clienteNombre} (${telefono})\n` +
        `${entrega}\n` +
        `Pago: ${pago}\n\n` +
        `${lineas}\n\n` +
        `*Total: $${pedido.total.toLocaleString("es-AR")}*\n` +
        (notas.trim() ? `Notas: ${notas.trim()}\n` : "") +
        `\n(Generado desde la web)`;

      // 3) ABRIMOS WhatsApp con el mensaje precargado.
      //    encodeURIComponent codifica espacios/saltos/acentos para la URL.
      const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(mensaje)}`;
      window.open(url, "_blank");

      // 4) VACIAMOS el carrito: el pedido ya quedó guardado.
      clear();
      navigate("/");
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar el pedido.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-full bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Para volver al catálogo sin retroceder con el navegador. */}
        <Link to="/" className="text-marca hover:underline text-sm">
          ← Volver a la tienda
        </Link>
        <h1 className="text-2xl font-bold my-4">Tu carrito</h1>

        {items.length === 0 ? (
          <div className="text-center py-10">
            <p className="mb-4">El carrito está vacío.</p>
            <Link to="/" className="text-marca underline">
              Volver a la tienda
            </Link>
          </div>
        ) : (
          <>
            {/* Lista de items con controles de cantidad */}
            <div className="space-y-3 mb-6">
              {items.map((i) => (
                <div key={i.producto.id} className="flex items-center justify-between bg-white border rounded-lg p-3">
                  <div>
                    <p className="font-semibold">{i.producto.nombre}</p>
                    {/* Qué eligió el cliente en los grupos del combo
                        ("Bebida: Coca 1.5L"), para confirmarlo antes de enviar. */}
                    {textoElecciones(i.producto, i.elecciones) && (
                      <p className="text-xs text-marca font-medium">
                        {textoElecciones(i.producto, i.elecciones)}
                      </p>
                    )}
                    <p className="text-sm text-gray-500">
                      ${precioEfectivo(i.producto).toLocaleString("es-AR")} c/u
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* - cantidad + */}
                    <button
                      onClick={() => setCantidad(i.producto.id, i.cantidad - 1)}
                      className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300"
                    >
                      −
                    </button>
                    <span className="w-8 text-center">{i.cantidad}</span>
                    <button
                      onClick={() => setCantidad(i.producto.id, i.cantidad + 1)}
                      className="w-8 h-8 rounded bg-gray-200 hover:bg-gray-300"
                    >
                      +
                    </button>
                    <button
                      onClick={() => remove(i.producto.id)}
                      className="ml-2 text-sm text-marca hover:underline"
                    >
                      Quitar
                    </button>
                  </div>
                  <p className="font-semibold w-24 text-right">
                    ${(precioEfectivo(i.producto) * i.cantidad).toLocaleString("es-AR")}
                  </p>
                </div>
              ))}
            </div>

            {/* Datos del cliente + tipo de entrega */}
            <div className="bg-white border rounded-lg p-4 space-y-3 mb-4">
              <h2 className="font-bold">Tus datos</h2>
              <input
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Nombre y apellido"
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
              />
              <input
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Teléfono (ej. 11 1234-5678)"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />

              {/* Delivery vs Take away. Si el dueño puso radio 0 en Ajustes,
                  la opción delivery sale bloqueada. */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">¿Cómo lo querés recibir?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTipoEntrega("takeaway")}
                    className={`flex-1 border rounded-lg py-2 text-sm font-semibold transition ${
                      tipoEntrega === "takeaway"
                        ? "border-marca bg-marca/5 text-marca"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    🏪 Take away
                  </button>
                  <button
                    type="button"
                    onClick={() => deliveryHabilitado && setTipoEntrega("delivery")}
                    disabled={!deliveryHabilitado}
                    title={deliveryHabilitado ? undefined : "La pizzería no ofrece delivery por ahora"}
                    className={`flex-1 border rounded-lg py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      tipoEntrega === "delivery"
                        ? "border-marca bg-marca/5 text-marca"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    🛵 Delivery
                  </button>
                </div>
                {/* Hint con el radio que configuró el dueño (informativo: el
                    alcance real lo confirma la pizzería por WhatsApp). */}
                {deliveryHabilitado ? (
                  <p className="text-xs text-gray-500 mt-1">
                    Delivery disponible hasta {config!.radio_delivery_km} km a la redonda del local.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    Por ahora solo tomamos pedidos para retirar en el local.
                  </p>
                )}
              </div>

              {/* Dirección: solo se pide si eligió delivery. */}
              {tipoEntrega === "delivery" && (
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="Dirección de entrega (calle, número, piso/depto)"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                />
              )}

              {/* Método de pago: informativo (el cobro se coordina por WhatsApp). */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">¿Cómo vas a pagar?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMetodoPago("efectivo")}
                    className={`flex-1 border rounded-lg py-2 text-sm font-semibold transition ${
                      metodoPago === "efectivo"
                        ? "border-marca bg-marca/5 text-marca"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    💵 Efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodoPago("mercado_pago")}
                    className={`flex-1 border rounded-lg py-2 text-sm font-semibold transition ${
                      metodoPago === "mercado_pago"
                        ? "border-marca bg-marca/5 text-marca"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    📱 Mercado Pago
                  </button>
                </div>
              </div>

              <textarea
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Notas (ej. con servilletas, sin orégano, entregá a las 20:30)"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
              />
            </div>

            {/* Total + enviar */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg">Total:</span>
              <span className="text-2xl font-bold">${total.toLocaleString("es-AR")}</span>
            </div>

            {error && <p className="text-marca mb-3">{error}</p>}

            <button
              onClick={enviarPedido}
              disabled={enviando}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-green-700 disabled:opacity-50"
            >
              {enviando ? "Enviando…" : "Enviar pedido por WhatsApp"}
            </button>

            <p className="text-xs text-gray-500 mt-3 text-center">
              No se cobra online. Tu pedido se guarda y se abre WhatsApp para que
              lo confirmes con la pizzería.
            </p>
          </>
        )}
      </main>
    </div>
  );
}