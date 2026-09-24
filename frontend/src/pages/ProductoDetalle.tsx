import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/api/client";
import type { Producto } from "@/types";
import { esCombo, galeriaProducto, gruposCombo, precioEfectivo } from "@/types";
import { useCart } from "@/context/CartContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// Página de detalle de un producto (/producto/:id). Las cards de la tienda
// son compactas (solo imagen, nombre y precio): acá vive la info completa —
// galería de TODAS las fotos, descripción, componentes del combo y los
// selectores de gustos (migrados de la vieja card gigante).
export default function ProductoDetalle() {
  const { id } = useParams<{ id: string }>();
  const [producto, setProducto] = useState<Producto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  useEffect(() => {
    // El id puede venir basura (/producto/abc): Number() lo vuelve NaN y el
    // backend responde 422 -> cae al mismo "no encontrado" que un 404.
    api
      .getProducto(Number(id))
      .then((data) => {
        setProducto(data);
        setNoEncontrado(false);
      })
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  }, [id]);

  if (cargando) {
    return (
      <div className="min-h-full bg-negro">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <p className="text-gray-300">Cargando…</p>
        </main>
        <Footer />
      </div>
    );
  }

  if (noEncontrado || !producto) {
    return (
      <div className="min-h-full bg-negro">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <Link to="/" className="text-marca hover:underline text-sm">
            ← Volver a la tienda
          </Link>
          <p className="text-gray-300 mt-4">Este producto no existe o ya no está disponible.</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-negro">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 py-6">
        <Link to="/" className="text-marca hover:underline text-sm">
          ← Volver a la tienda
        </Link>

        {esCombo(producto) ? (
          <DetalleCombo producto={producto} />
        ) : (
          <DetalleSimple producto={producto} />
        )}
      </main>

      <Footer />
    </div>
  );
}

// ---------- Galería (compartida por detalle de combo y simple) ----------
// Imagen activa grande + miniaturas clickeables si hay más de una. Sin
// librerías externas: la galería son botones con borde-marca en la activa.
function Galeria({ producto }: { producto: Producto }) {
  const fotos = galeriaProducto(producto);
  const [indice, setIndice] = useState(0);

  // Si el producto cambia (mismo componente reusado), el índice puede quedar
  // fuera de rango: clamp al array nuevo.
  const activa = Math.min(indice, fotos.length - 1);

  return (
    <div>
      {fotos.length > 0 ? (
        <img
          src={fotos[activa]}
          alt={producto.nombre}
          className="w-full aspect-square object-cover rounded-xl border border-negro-borde"
        />
      ) : (
        <div className="w-full aspect-square rounded-xl bg-negro-panel border border-negro-borde flex items-center justify-center text-7xl">
          {esCombo(producto) ? "🎉" : "🍫"}
        </div>
      )}

      {fotos.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {fotos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setIndice(i)}
              aria-label={`Ver foto ${i + 1} de ${producto.nombre}`}
              className={`shrink-0 rounded-lg overflow-hidden border-2 transition ${
                i === activa ? "border-marca" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <img src={url} alt="" className="w-16 h-16 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Badges + nombre + descripción + precios (bloque de info) ----------
function InfoProducto({ producto }: { producto: Producto }) {
  const sinStock = producto.stock <= 0;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {esCombo(producto) && (
          <span className="self-start bg-marca text-black text-xs font-bold px-2 py-0.5 rounded">
            COMBO
          </span>
        )}
        {producto.etiqueta && (
          <span className="self-start border border-marca/40 text-marca text-xs font-bold px-2 py-0.5 rounded">
            {producto.etiqueta}
          </span>
        )}
        {!esCombo(producto) && producto.en_oferta && (
          <span className="self-start bg-marca text-black text-xs font-bold px-2 py-0.5 rounded">
            OFERTA
          </span>
        )}
        {sinStock && (
          <span className="self-start bg-gray-700 text-white text-xs font-bold px-2 py-0.5 rounded">
            SIN STOCK
          </span>
        )}
      </div>

      <h1 className="font-bold text-2xl text-gray-100">{producto.nombre}</h1>

      {producto.descripcion && (
        <p className="text-sm text-gray-400 mt-2">{producto.descripcion}</p>
      )}

      <div className="mt-3">
        {producto.en_oferta && producto.precio_oferta != null ? (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 line-through text-base">
              ${producto.precio.toLocaleString("es-AR")}
            </span>
            <span className="text-marca font-bold text-2xl">
              ${producto.precio_oferta.toLocaleString("es-AR")}
            </span>
          </div>
        ) : (
          <span className="font-bold text-2xl text-marca">
            ${producto.precio.toLocaleString("es-AR")}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Detalle de un COMBO ----------
// "Qué incluye" (fijos + grupos a elección) y los selectores de gustos que
// vivían en la card de la tienda (acá es donde el cliente arma su pedido).
function DetalleCombo({ producto }: { producto: Producto }) {
  const { add, items } = useCart();

  const sinStock = producto.stock <= 0;
  const enCarrito = items.find((i) => i.producto.id === producto.id);
  const cantidad = enCarrito?.cantidad ?? 0;

  // Grupos a elección del combo (ej: "Bebida": [Coca, Agua, Fanta]). Cada
  // grupo es "N unidades a repartir": una bebida es elegir UNA (N=1), 6
  // empanadas es repartir gustos (3+3).
  const grupos = gruposCombo(producto);
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

  const sumaGrupo = (grupo: string) =>
    Object.values(elecciones[grupo] ?? {}).reduce((s, c) => s + c, 0);

  // ¿Todos los grupos completos (la suma da exacto N)? Sin esto no se puede
  // agregar al carrito: el backend lo rechazaría igual.
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
    // Mandamos {grupo, producto_id, cantidad} por cada opción con unidades
    // asignadas (la suma por grupo da exacto N).
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
  }

  const fijos = (producto.combo_items ?? []).filter((ci) => !ci.grupo);

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-4">
      <Galeria producto={producto} />

      <div className="flex flex-col">
        <InfoProducto producto={producto} />

        {/* Qué incluye: el detalle que antes hinchaba la card. Los precios
            unitarios son descriptivos: se cobra el precio del combo. */}
        {(fijos.length > 0 || grupos.length > 0) && (
          <div className="mt-4 border border-negro-borde rounded-xl bg-negro-panel p-3">
            <h2 className="font-bold text-sm text-gray-100 mb-2">Qué incluye</h2>
            <ul className="text-sm text-gray-300 space-y-1">
              {fijos.map((ci) => (
                <li key={ci.producto_id}>
                  • {ci.cantidad}× {ci.nombre}
                  <span className="text-gray-500 ml-1">
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
          </div>
        )}

        {/* Selector por grupo a elección. N=1: un <select> simple. N>1: el
            cliente reparte las unidades entre las opciones (3 carne + 3 queso)
            hasta completar los N lugares del grupo. */}
        {grupos.length > 0 && !sinStock && (
          <div className="mt-4 space-y-2">
            {grupos.map(({ grupo, opciones }) => {
              const N = lugares(grupo);
              if (N === 1) {
                // Un solo lugar: elegir una opción del <select>.
                const actual = Number(Object.keys(elecciones[grupo] ?? {})[0]);
                return (
                  <label key={grupo} className="block">
                    <span className="text-xs font-semibold text-gray-300">
                      Elegí tu {grupo.toLowerCase()}:
                    </span>
                    <select
                      value={actual}
                      onChange={(e) => elegirUnidad(grupo, Number(e.target.value))}
                      className="w-full mt-0.5 border border-negro-borde rounded-lg px-2 py-1.5 text-sm bg-negro text-gray-100"
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
                <div key={grupo} className="border border-negro-borde rounded-lg p-2 bg-negro">
                  <p className="text-xs font-semibold text-gray-300">
                    Elegí {N} {grupo.toLowerCase()}s (gustos a tu gusto):
                    <span className={`ml-1 ${suma === N ? "text-green-400" : "text-marca"}`}>
                      {suma}/{N}
                    </span>
                  </p>
                  <div className="mt-1 space-y-1">
                    {opciones.map((o) => {
                      const cant = elecciones[grupo]?.[o.producto_id] ?? 0;
                      const sinUnidades = o.stock <= 0;
                      return (
                        <div key={o.producto_id} className="flex items-center gap-2 text-sm">
                          <span className={`flex-1 ${sinUnidades ? "text-gray-500 line-through" : "text-gray-200"}`}>
                            {o.nombre}
                          </span>
                          <button
                            type="button"
                            onClick={() => cambiarCantidad(grupo, o.producto_id, cant - 1)}
                            disabled={cant === 0}
                            className="w-6 h-6 rounded bg-negro-borde hover:bg-gray-600 disabled:opacity-30"
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
                            className="w-6 h-6 rounded bg-negro-borde hover:bg-gray-600 disabled:opacity-30"
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

        {sinStock && (
          <p className="mt-4 text-sm text-gray-400">
            No queda stock de este combo en este momento.
          </p>
        )}

        <button
          onClick={agregarAlCarrito}
          disabled={sinStock || !gruposCompletos}
          title={!gruposCompletos ? "Completá las opciones a elección primero" : undefined}
          className="mt-4 bg-marca text-black py-2 rounded-lg font-semibold hover:bg-marca-clara disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {sinStock ? "Sin stock" : cantidad > 0 ? "Agregar una más" : "Agregar al carrito"}
        </button>
      </div>
    </div>
  );
}

// ---------- Detalle de un producto SIMPLE ----------
// La card ya permite agregar directo; acá además se puede elegir cantidad.
function DetalleSimple({ producto }: { producto: Producto }) {
  const { add, items } = useCart();

  const sinStock = producto.stock <= 0;
  const enCarrito = items.find((i) => i.producto.id === producto.id);
  const cantidadEnCarrito = enCarrito?.cantidad ?? 0;

  const [cantidad, setCantidad] = useState(1);
  const precio = precioEfectivo(producto);

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-4">
      <Galeria producto={producto} />

      <div className="flex flex-col">
        <InfoProducto producto={producto} />

        {sinStock ? (
          <p className="mt-4 text-sm text-gray-400">
            No queda stock de este producto en este momento.
          </p>
        ) : (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-300 mb-1">Cantidad:</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                disabled={cantidad <= 1}
                className="w-8 h-8 rounded bg-negro-borde hover:bg-gray-600 disabled:opacity-30"
                aria-label="Quitar una unidad"
              >
                −
              </button>
              <span className="w-8 text-center font-semibold text-gray-100">{cantidad}</span>
              <button
                type="button"
                onClick={() => setCantidad((c) => Math.min(producto.stock, c + 1))}
                disabled={cantidad >= producto.stock}
                className="w-8 h-8 rounded bg-negro-borde hover:bg-gray-600 disabled:opacity-30"
                aria-label="Agregar una unidad"
              >
                +
              </button>
              <span className="ml-2 text-sm text-gray-400">
                Total: ${(precio * cantidad).toLocaleString("es-AR")}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => add(producto, cantidad)}
          disabled={sinStock}
          className="mt-4 bg-marca text-black py-2 rounded-lg font-semibold hover:bg-marca-clara disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {sinStock ? "Sin stock" : cantidadEnCarrito > 0 ? "Agregar una más" : "Agregar al carrito"}
        </button>
      </div>
    </div>
  );
}