import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useCart } from "@/context/CartContext";
import { precioEfectivo } from "@/types";
import Navbar from "@/components/Navbar";

export default function Carrito() {
  const { items, setCantidad, remove, total, clear } = useCart();
  const navigate = useNavigate();

  // Datos del cliente que pide. El teléfono coincide con el que usará en WhatsApp.
  const [clienteNombre, setClienteNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Número de WhatsApp de la pizzería (var de entorno). Formato internacional sin +.
  const waNumber = import.meta.env.VITE_WA_NUMBER || "0";

  async function enviarPedido() {
    setError(null);
    if (!clienteNombre.trim() || !telefono.trim()) {
      setError("Completa tu nombre y teléfono.");
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
        notas: notas.trim() || null,
        items: items.map((i) => ({ producto_id: i.producto.id, cantidad: i.cantidad })),
      });

      // 2) ARMAMOS el mensaje de WhatsApp con el #ID del pedido.
      const lineas = items
        .map(
          (i) =>
            `• ${i.cantidad}x ${i.producto.nombre} — $${precioEfectivo(i.producto).toLocaleString(
              "es-AR"
            )} c/u`
        )
        .join("\n");
      const mensaje =
        `*Nuevo pedido #${pedido.id}* 🍕\n` +
        `Cliente: ${clienteNombre} (${telefono})\n\n` +
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
        <h1 className="text-2xl font-bold mb-4">Tu carrito</h1>

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

            {/* Datos del cliente */}
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