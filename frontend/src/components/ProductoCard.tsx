import { useState } from "react";
import type { Producto } from "@/types";
import { esCombo, gruposCombo } from "@/types";
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

  // Grupos a elección del combo (ej: "Bebida": [Coca, Agua, Fanta] o
  // "Empanada": [Carne, Quesa, Jamón]). Cada grupo es "N unidades a repartir":
  // una bebida es elegir UNA (N=1), 6 empanadas es repartir gustos (3+3).
  const grupos = esCombo(producto) ? gruposCombo(producto) : [];
  const lugares = (grupo: string) =>
    grupos.find((g) => g.grupo === grupo)?.opciones[0]?.cantidad ?? 1;

  // Elecciones por grupo: { grupo: { producto_id: cantidad } }.
  //  - N=1 (ej: bebida): arranca en la primera opción con stock.
  //  - N>1 (ej: 6 empanadas): arranca vacío, el cliente reparte a mano.
  const [elecciones, setElecciones] = useState<Record<string, Record<number, number>>>(() => {
    const iniciales: Record<string, Record<number, number>> = {};
    for (const { grupo, opciones } of grupos) {
      if (lugares(grupo) === 1) {
        const conStock = opciones.find((ci) => ci.stock > 0);
        iniciales[grupo] = { [(conStock ?? opciones[0]).producto_id]: 1 };
      }
    }
    return iniciales;
  });

  // Cuántas unidades ya están asignadas en un grupo.
  const sumaGrupo = (grupo: string) =>
    Object.values(elecciones[grupo] ?? {}).reduce((s, c) => s + c, 0);

  // ¿Todos los grupos están completos (la suma da exacto N)? Sin esto no se
  // puede agregar al carrito: el backend lo rechazaría igual.
  const gruposCompletos = grupos.every(({ grupo }) => sumaGrupo(grupo) === lugares(grupo));

  function elegirUnidad(grupo: string, producto_id: number) {
    setElecciones((prev) => ({ ...prev, [grupo]: { ...prev[grupo], [producto_id]: 1 } }));
  }

  function cambiarCantidad(grupo: string, producto_id: number, cantidad: number) {
    setElecciones((prev) => {
      const del_grupo = { ...(prev[grupo] ?? {}) };
      if (cantidad <= 0) delete del_grupo[producto_id];
      else del_grupo[producto_id] = cantidad;
      return { ...prev, [grupo]: del_grupo };
    });
  }

  function agregarAlCarrito() {
    if (grupos.length > 0) {
      // Combos con grupos: mandamos {grupo, producto_id, cantidad} por cada
      // opción con unidades asignadas (la suma por grupo da exacto N).
      add(
        producto,
        1,
        grupos.flatMap(({ grupo }) =>
          Object.entries(elecciones[grupo] ?? {}).map(([pid, cantidad]) => ({
            grupo,
            producto_id: Number(pid),
            cantidad,
          }))
        )
      );
    } else {
      add(producto);
    }
  }

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
            El precio del combo manda; los precios unitarios son descriptivos.
            Las opciones de un mismo grupo se muestran como alternativas
            ("Bebida a elección: Coca / Agua / Fanta"), no como suma. */}
        {esCombo(producto) && (producto.combo_items?.length ?? 0) > 0 && (
          <ul className="text-sm text-gray-600 my-1 space-y-0.5">
            {(producto.combo_items ?? [])
              .filter((ci) => !ci.grupo)
              .map((ci) => (
                <li key={ci.producto_id}>
                  • {ci.cantidad}× {ci.nombre}
                  <span className="text-gray-400 ml-1">
                    (${ci.precio_unitario.toLocaleString("es-AR")} c/u)
                  </span>
                </li>
              ))}
            {grupos.map(({ grupo, opciones }) => (
              <li key={grupo}>
                • {opciones[0]?.cantidad}× a elección:{" "}
                <span className="text-marca font-semibold">{grupo}</span>{" "}
                ({opciones.map((o) => o.nombre).join(" / ")})
              </li>
            ))}
          </ul>
        )}

        {/* Selector por grupo a elección. N=1: un <select> simple. N>1: el
            cliente reparte las unidades entre las opciones (3 carne + 3 queso)
            hasta completar los N lugares del grupo. */}
        {grupos.length > 0 && !sinStock && (
          <div className="my-2 space-y-2">
            {grupos.map(({ grupo, opciones }) => {
              const N = lugares(grupo);
              if (N === 1) {
                // Un solo lugar: elegir una opción del <select>.
                const actual = Number(Object.keys(elecciones[grupo] ?? {})[0]);
                return (
                  <label key={grupo} className="block">
                    <span className="text-xs font-semibold text-gray-700">
                      Elegí tu {grupo.toLowerCase()}:
                    </span>
                    <select
                      value={actual}
                      onChange={(e) => elegirUnidad(grupo, Number(e.target.value))}
                      className="w-full mt-0.5 border rounded-lg px-2 py-1.5 text-sm bg-white"
                    >
                      {opciones.map((o) => (
                        <option key={o.producto_id} value={o.producto_id} disabled={o.stock <= 0}>
                          {o.nombre}
                          {o.stock <= 0 ? " (sin stock)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              // Varios lugares: repartir entre gustos con +/- por opción.
              const suma = sumaGrupo(grupo);
              return (
                <div key={grupo} className="border rounded-lg p-2 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-700">
                    Elegí {N} {grupo.toLowerCase()}s (gustos a tu gusto):
                    <span className={`ml-1 ${suma === N ? "text-green-700" : "text-marca"}`}>
                      {suma}/{N}
                    </span>
                  </p>
                  <div className="mt-1 space-y-1">
                    {opciones.map((o) => {
                      const cant = elecciones[grupo]?.[o.producto_id] ?? 0;
                      const sinUnidades = o.stock <= 0;
                      return (
                        <div key={o.producto_id} className="flex items-center gap-2 text-sm">
                          <span className={`flex-1 ${sinUnidades ? "text-gray-400 line-through" : ""}`}>
                            {o.nombre}
                          </span>
                          <button
                            type="button"
                            onClick={() => cambiarCantidad(grupo, o.producto_id, cant - 1)}
                            disabled={cant === 0}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30"
                            aria-label={`Quitar una ${o.nombre}`}
                          >
                            −
                          </button>
                          <span className="w-6 text-center">{cant}</span>
                          <button
                            type="button"
                            onClick={() => cambiarCantidad(grupo, o.producto_id, cant + 1)}
                            // No se puede pasar del total de lugares del grupo
                            // (ni pedir más de lo que hay en stock de la opción).
                            disabled={suma >= N || cant >= o.stock}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30"
                            aria-label={`Agregar una ${o.nombre}`}
                          >
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
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
          onClick={agregarAlCarrito}
          disabled={sinStock || !gruposCompletos}
          title={!gruposCompletos ? "Completá las opciones a elección primero" : undefined}
          className="mt-3 bg-marca text-white py-2 rounded-lg font-semibold hover:bg-marca-oscura disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {sinStock ? "Sin stock" : cantidad > 0 ? "Agregar una más" : "Agregar"}
        </button>
      </div>
    </div>
  );
}