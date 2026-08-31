import type { Producto } from "@/types";
import { esCombo } from "@/types";
import { useCart } from "@/context/CartContext";

export default function ProductoCard({ producto }: { producto: Producto }) {
  const { add, items } = useCart();

  // El cliente no ve el número de stock. Si el producto está acá y no tiene
  // stock, es porque el dueño desactivó la "alarma" (mostrar_sin_stock): lo
  // mostramos marcado como "Sin stock" y sin poder agregarlo.
  const sinStock = producto.stock <= 0;

  // Cantidad de este producto que ya hay en el carrito (0 si no está). Nos
  // sirve para el badge con la cantidad que pidió el dueño.
  const enCarrito = items.find((i) => i.producto.id === producto.id);
  const cantidad = enCarrito?.cantidad ?? 0;

  return (
    <div className="relative border rounded-xl bg-white shadow-sm flex flex-col overflow-hidden">
      {/* Badge con la cantidad en carrito: solo si el producto ya fue agregado. */}
      {cantidad > 0 && (
        <span className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-marca text-white text-xs font-bold flex items-center justify-center shadow-md">
          {cantidad}
        </span>
      )}
      {/* Imagen (si tiene). Si no, un placeholder. */}
      {producto.imagen_url ? (
        <img
          src={producto.imagen_url}
          alt={producto.nombre}
          className="w-full h-40 object-cover"
        />
      ) : (
        <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-5xl">
          🍕
        </div>
      )}

      <div className="p-4 flex flex-col flex-1">
        {/* Badge de combo: más vistoso que una simple oferta, y con etiqueta
            libre del dueño (ej: "🍻 Día del Amigo"). */}
        {esCombo(producto) && (
          <span className="self-start bg-marca text-white text-xs font-bold px-2 py-0.5 rounded mb-2">
            COMBO
          </span>
        )}
        {producto.etiqueta && (
          <span className="self-start bg-gray-100 border border-marca/30 text-marca text-xs font-bold px-2 py-0.5 rounded mb-2">
            {producto.etiqueta}
          </span>
        )}
        {!esCombo(producto) && producto.en_oferta && (
          <span className="self-start bg-marca text-white text-xs font-bold px-2 py-0.5 rounded mb-2">
            OFERTA
          </span>
        )}
        {sinStock && (
          <span className="self-start bg-gray-700 text-white text-xs font-bold px-2 py-0.5 rounded mb-2">
            SIN STOCK
          </span>
        )}

        <h3 className="font-bold text-lg">{producto.nombre}</h3>

        {/* Combo: mostramos SUS COMPONENTES (el "6× Empanada + 2× Coca").
            El precio del combo manda; los precios unitarios son descriptivos. */}
        {esCombo(producto) && (producto.combo_items?.length ?? 0) > 0 && (
          <ul className="text-sm text-gray-600 my-1 space-y-0.5">
            {(producto.combo_items ?? []).map((ci) => (
              <li key={ci.producto_id}>
                • {ci.cantidad}× {ci.nombre}
                <span className="text-gray-400 ml-1">
                  (${ci.precio_unitario.toLocaleString("es-AR")} c/u)
                </span>
              </li>
            ))}
          </ul>
        )}

        {producto.descripcion && (
          <p className="text-sm text-gray-600 flex-1">{producto.descripcion}</p>
        )}

        {/* Precios */}
        <div className="mt-2">
          {producto.en_oferta && producto.precio_oferta != null ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 line-through text-sm">
                ${producto.precio.toLocaleString("es-AR")}
              </span>
              <span className="text-marca font-bold text-xl">
                ${producto.precio_oferta.toLocaleString("es-AR")}
              </span>
            </div>
          ) : (
            <span className="font-bold text-xl">
              ${producto.precio.toLocaleString("es-AR")}
            </span>
          )}
        </div>

        <button
          onClick={() => add(producto)}
          disabled={sinStock}
          className="mt-3 bg-marca text-white py-2 rounded-lg font-semibold hover:bg-marca-oscura disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {sinStock ? "Sin stock" : cantidad > 0 ? "Agregar una más" : "Agregar"}
        </button>
      </div>
    </div>
  );
}