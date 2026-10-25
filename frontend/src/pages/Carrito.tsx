import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useCart } from "@/context/CartContext";
import { precioEfectivo, textoElecciones, type LocalConfig, type TipoPago } from "@/types";
import Navbar from "@/components/Navbar";

export default function Carrito() {
  const { items, setCantidad, remove, total, clear } = useCart();
  const navigate = useNavigate();

  // Modelo B2B: el proveedor envía directamente al local que pide.
  //  - Nombre: contacto de quien pide (o el nombre del local).
  //  - Dirección: dónde entregar (obligatoria, es lo único que necesita el envío).
  //  - Teléfono NO se pide: el contacto es WhatsApp y el número ya lo tenemos ahí.
  const [clienteNombre, setClienteNombre] = useState("");
  const [notas, setNotas] = useState("");
  const [direccion, setDireccion] = useState("");
  // Pago: se coordina por WhatsApp (no hay cobro online). Queda registrado
  // para que el proveedor prepare el cambio o mande el link de Mercado Pago.
  const [metodoPago, setMetodoPago] = useState<TipoPago>("efectivo");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config del dueño: el número de WhatsApp que recibe los pedidos. Con esto
  // el dueño controla TODO sin tocar código ni variables de entorno.
  const [config, setConfig] = useState<LocalConfig | null>(null);
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Número de WhatsApp: prioriza el de la config del dueño; fallback a la var
  // de entorno (comportamiento original). "0" = inválido => solo se guarda el pedido.
  const waNumber = config?.whatsapp || import.meta.env.VITE_WA_NUMBER || "0";

  async function enviarPedido() {
    setError(null);
    if (!clienteNombre.trim()) {
      setError("Completa tu nombre (o el del local).");
      return;
    }
    if (!direccion.trim()) {
      setError("Necesitamos la dirección del local para enviar el pedido.");
      return;
    }
    if (items.length === 0) return;

    setEnviando(true);
    try {
      // 1) GUARDAMOS el pedido en la base de datos (estado "pendiente").
      //    El backend calcula el total y hace el snapshot de precios.
      const pedido = await api.createPedido({
        cliente_nombre: clienteNombre.trim(),
        // En el modelo B2B todo pedido es un envío al local que pide.
        tipo_entrega: "delivery",
        direccion: direccion.trim(),
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
      const pago = metodoPago === "mercado_pago" ? "📱 Mercado Pago" : "💵 Efectivo";
      // Sin el # de pedido: el ID queda en la base (dashboard), el texto de
      // WhatsApp es solo la info que el dueño necesita para armar el pedido.
      const mensaje =
        `*Nuevo pedido* 🍫\n` +
        `Local: ${clienteNombre}\n` +
        `🛵 Envío a: ${direccion.trim()}\n` +
        `Pago: ${pago}\n\n` +
        `${lineas}\n\n` +
        `*Total: $${pedido.total.toLocaleString("es-AR")}*\n` +
        (notas.trim() ? `Notas: ${notas.trim()}\n` : "");

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
    <div className="min-h-full bg-negro">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* Para volver al catálogo sin retroceder con el navegador. */}
        <Link to="/" className="text-marca hover:underline text-sm">
          ← Volver a la tienda
        </Link>
        <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-tight text-gray-100 my-4">
          Tu carrito
        </h1>

        {items.length === 0 ? (
          <div className="text-center py-10 text-gray-200">
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
                <div key={i.producto.id} className="flex items-center justify-between bg-negro-panel border border-negro-borde rounded-lg p-3 shadow-card">
                  <div>
                    <p className="font-semibold">{i.producto.nombre}</p>
                    {/* Qué eligió el cliente en los grupos del combo
                        ("Bebida: Coca 1.5L"), para confirmarlo antes de enviar. */}
                    {textoElecciones(i.producto, i.elecciones) && (
                      <p className="text-xs text-marca font-medium">
                        {textoElecciones(i.producto, i.elecciones)}
                      </p>
                    )}
                    <p className="text-sm text-gray-400">
                      ${precioEfectivo(i.producto).toLocaleString("es-AR")} c/u
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* - cantidad + */}
                    <button
                      onClick={() => setCantidad(i.producto.id, i.cantidad - 1)}
                      className="w-8 h-8 rounded bg-negro-borde hover:bg-gray-600"
                    >
                      −
                    </button>
                    <span className="w-8 text-center">{i.cantidad}</span>
                    <button
                      onClick={() => setCantidad(i.producto.id, i.cantidad + 1)}
                      className="w-8 h-8 rounded bg-negro-borde hover:bg-gray-600"
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

            {/* Datos del local que pide (modelo B2B: el proveedor envía al
                local, no hay retiro ni teléfono — el contacto es WhatsApp). */}
            <div className="bg-negro-panel border border-negro-borde rounded-lg p-4 space-y-3 mb-4 text-gray-200">
              <h2 className="font-bold">Datos del local</h2>
              <input
                className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
                placeholder="Tu nombre o el del local"
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
              />
              <input
                className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
                placeholder="Dirección del local (calle, número, ciudad)"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
              />

              {/* Método de pago: informativo (el cobro se coordina por WhatsApp). */}
              <div>
                <p className="text-sm font-semibold text-gray-300 mb-1">¿Con qué vas a pagar?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMetodoPago("efectivo")}
                    className={`flex-1 border rounded-lg py-2 text-sm font-semibold transition ${
                      metodoPago === "efectivo"
                        ? "border-marca bg-marca/10 text-marca"
                        : "border-negro-borde hover:border-gray-500"
                    }`}
                  >
                    💵 Efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodoPago("mercado_pago")}
                    className={`flex-1 border rounded-lg py-2 text-sm font-semibold transition ${
                      metodoPago === "mercado_pago"
                        ? "border-marca bg-marca/10 text-marca"
                        : "border-negro-borde hover:border-gray-500"
                    }`}
                  >
                    📱 Mercado Pago
                  </button>
                </div>
              </div>

              <textarea
                className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
                placeholder="Notas (ej. Entrega entre 13.30 a 18.00)"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
              />
            </div>

            {/* Total + enviar */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-300 font-semibold">Total:</span>
              <span className="font-display text-2xl text-marca">${total.toLocaleString("es-AR")}</span>
            </div>

            {error && <p className="text-marca mb-3">{error}</p>}

            <button
              onClick={enviarPedido}
              disabled={enviando}
              className="w-full bg-marca text-black py-3 rounded-lg font-bold text-lg hover:bg-marca-clara hover:shadow-glow active:scale-[0.99] disabled:opacity-50 disabled:hover:shadow-none transition-all"
            >
              {enviando ? "Enviando…" : "Enviar pedido por WhatsApp"}
            </button>

            <p className="text-xs text-gray-400 mt-3 text-center">
              No se cobra online. Tu pedido se guarda y se abre WhatsApp para que
              lo confirmes con el proveedor.
            </p>
          </>
        )}
      </main>
    </div>
  );
}