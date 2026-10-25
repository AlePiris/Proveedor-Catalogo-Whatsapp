import { Link } from "react-router-dom";
import type { Producto } from "@/types";
import { esCombo } from "@/types";
import { useCart } from "@/context/CartContext";

// Card COMPACTA del catálogo: imagen, badges, nombre y precio. Los combos ya
// no enumeran componentes ni traen selectores de gustos (eso hinchaba la card):
// su botón lleva a la página de detalle (/producto/:id), donde el cliente ve
// el contenido, elige los gustos y agrega al carrito. Los productos simples
// sí se agregan directo desde la card, con un link al detalle debajo.
export default function ProductoCard({ producto }: { producto: Producto }) {
  const { add, items } = useCart();

  // El cliente no ve el número de stock. Si el producto está acá y no tiene
  // stock, es porque el dueño desactivó la "alarma" (mostrar_sin_stock): lo
  // mostramos marcado como "Sin stock" y sin poder agregarlo.
  const sinStock = producto.stock <= 0;

  // Cantidad de este producto que ya hay en el carrito (0 si no está). Nos
  // sirve para el badge con la cantidad que pidió el cliente.
  const enCarrito = items.find((i) => i.producto.id === producto.id);
  const cantidad = enCarrito?.cantidad ?? 0;

  return (
    <div
      className="group relative border border-negro-borde rounded-xl bg-negro-panel shadow-card flex flex-col overflow-hidden
                 hover:border-marca/30 hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Badge con la cantidad en carrito: solo si el producto ya fue agregado. */}
      {cantidad > 0 && (
        <span className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-marca text-white text-xs font-bold flex items-center justify-center shadow-md ring-2 ring-negro-panel">
          {cantidad}
        </span>
      )}
      {/* Imagen (si tiene). Si no, un placeholder. aspect-square: la foto
          mantiene proporción en cualquier ancho de card, sin recortes raros
          (las fotos de packaging son verticales y con h-40 fijo quedaban mal).
          Toda la imagen lleva al detalle. Zoom sutil al pasar el mouse. */}
      <Link to={`/producto/${producto.id}`} className="block overflow-hidden">
        {producto.imagen_url ? (
          <img
            src={producto.imagen_url}
            alt={producto.nombre}
            className="w-full aspect-square object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="w-full aspect-square bg-negro flex items-center justify-center text-5xl">
            {esCombo(producto) ? "🎉" : "🍫"}
          </div>
        )}
      </Link>

      <div className="p-3 flex flex-col flex-1 gap-0.5">
        {/* Badge de combo: más vistoso que una simple oferta, y con etiqueta
            libre del dueño (ej: "🍻 Día del Amigo"). Chips estilo etiqueta */}
        {esCombo(producto) && (
          <span className="self-start bg-marca text-black text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2">
            Combo
          </span>
        )}
        {producto.etiqueta && (
          <span className="self-start border border-marca/40 text-marca text-[11px] font-bold px-2 py-0.5 rounded-full mb-2">
            {producto.etiqueta}
          </span>
        )}
        {!esCombo(producto) && producto.en_oferta && (
          <span className="self-start bg-marca text-black text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2">
            Oferta
          </span>
        )}
        {sinStock && (
          <span className="self-start bg-gray-700 text-white text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2">
            Sin stock
          </span>
        )}

        <h3 className="font-bold text-base text-gray-100 group-hover:text-white transition-colors">
          {producto.nombre}
        </h3>

        {/* Precios */}
        <div className="mt-2">
          {producto.en_oferta && producto.precio_oferta != null ? (
            <div className="flex items-baseline gap-2">
              <span className="text-gray-500 line-through text-sm">
                ${producto.precio.toLocaleString("es-AR")}
              </span>
              <span className="text-marca font-extrabold text-lg">
                ${producto.precio_oferta.toLocaleString("es-AR")}
              </span>
            </div>
          ) : (
            <span className="font-extrabold text-lg text-marca">
              ${producto.precio.toLocaleString("es-AR")}
            </span>
          )}
        </div>

        {/* Combos: la card NO arma el pedido (componentes y gustos viven en
            el detalle). Simples: agregar directo + link al detalle. */}
        {esCombo(producto) ? (
          <Link
            to={`/producto/${producto.id}`}
            className="mt-3 block text-center bg-marca text-black py-1.5 rounded-lg text-sm font-bold hover:bg-marca-clara active:scale-[0.98] transition"
          >
            Ver detalle
          </Link>
        ) : (
          <>
            <button
              onClick={() => add(producto)}
              disabled={sinStock}
              className="mt-3 bg-marca text-black py-1.5 rounded-lg text-sm font-bold hover:bg-marca-clara active:scale-[0.98] hover:shadow-glow disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all"
            >
              {sinStock ? "Sin stock" : cantidad > 0 ? "Agregar una más" : "Agregar"}
            </button>
            <Link
              to={`/producto/${producto.id}`}
              className="mt-1 block text-center text-marca hover:underline text-xs font-semibold"
            >
              Ver detalle
            </Link>
          </>
        )}
      </div>
    </div>
  );
}