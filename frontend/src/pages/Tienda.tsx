import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { Categoria, Producto } from "@/types";
import { precioEfectivo } from "@/types";
import { useCart } from "@/context/CartContext";
import { esCombo } from "@/types";
import Navbar from "@/components/Navbar";
import ProductoCard from "@/components/ProductoCard";
import Footer from "@/components/Footer";

export default function Tienda() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { items, setCantidad, clear, total, totalItems } = useCart();

  // Ref al panel del pedido y memo del último total conocido: al agregar un
  // producto (totalItems sube) hacemos scroll hasta el panel, que en mobile
  // queda debajo de la grilla y sin scroll el cliente no lo percibiría.
  const panelRef = useRef<HTMLElement>(null);
  const prevTotal = useRef(totalItems);
  useEffect(() => {
    if (totalItems > prevTotal.current) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevTotal.current = totalItems;
  }, [totalItems]);

  // Al montar, pedimos los productos y las categorías. El backend ya los
  // devuelve ordenados (ofertas primero), pero acá los separamos en secciones.
  useEffect(() => {
    api
      .getProductos()
      .then((data) => setProductos(data))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
    // Categorías: las usa el orden de las secciones de abajo. Si falla el
    // GET, NO es fatal: las secciones igual se muestran (al final, orden
    // alfabético) — la tienda no depende de esta tabla para funcionar.
    api.getCategorias().then(setCategorias).catch(() => {});
  }, []);

  const combos = productos.filter(esCombo);
  const ofertas = productos.filter((p) => p.en_oferta && !esCombo(p));
  const resto = productos.filter((p) => !p.en_oferta && !esCombo(p));

  // Agrupa el resto (ni combos ni ofertas) UNA SECCIÓN POR CATEGORÍA, en el
  // orden que definió el dueño en la tabla de categorías. Las categorías que
  // no existen en esa tabla (o si el GET falló) van al final en orden
  // alfabético — así ningún producto se pierde por un problema de datos.
  const porCategoria = new Map<string, Producto[]>();
  for (const p of resto) {
    const lista = porCategoria.get(p.categoria);
    if (lista) lista.push(p);
    else porCategoria.set(p.categoria, [p]);
  }
  const conocidas = categorias.filter((c) => porCategoria.has(c.nombre));
  const desconocidas = [...porCategoria.keys()]
    .filter((n) => !categorias.some((c) => c.nombre === n))
    .sort((a, b) => a.localeCompare(b));
  const secciones = [
    ...conocidas.map((c) => ({ nombre: c.nombre, productos: porCategoria.get(c.nombre)! })),
    ...desconocidas.map((n) => ({ nombre: n, productos: porCategoria.get(n)! })),
  ];

  // Slides del carrusel: primero los combos, después las ofertas. Cada slide
  // sabe a qué sección lleva al usuario cuando lo tocan (scroll a la sección).
  const slides = [
    ...combos.map((c) => ({ tipo: "combo" as const, producto: c, destino: "combos" })),
    ...ofertas.map((o) => ({ tipo: "oferta" as const, producto: o, destino: "ofertas" })),
  ];

  return (
    <div className="min-h-full bg-gray-50">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Nuestros productos</h1>

        {/* Carrusel de promos: gira solo entre combos y ofertas. Al tocarlo
            lleva a la sección correspondiente de la página. */}
        <CarruselPromos slides={slides} />

        {cargando && <p>Cargando…</p>}
        {error && <p className="text-marca">Error: {error}</p>}

        {/* Flex: en desktop los productos a la izquierda y el panel del pedido
            fijo a la derecha (sticky). En mobile se apilan: grilla arriba,
            panel debajo. Solo se muestra cuando hay algo en el carrito. */}
        <div className="lg:flex lg:items-start lg:gap-6">
          <div className="flex-1 min-w-0">
            {/* Sección de COMBOS: primera, cards más grandes (2 por fila),
                para darle protagonismo a las promos del dueño. Si no hay
                combos activos, la sección ni se muestra. */}
            {/* id = "combos": es donde scrollea el carrusel. Cards del MISMO
                tamaño que el resto del catálogo (grid de 3 columnas). */}
            {combos.length > 0 && (
              <section id="combos" className="mb-8 scroll-mt-20">
                <h2 className="text-xl font-bold text-marca mb-3">🎉 Combos y especiales</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {combos.map((p) => (
                    <ProductoCard key={p.id} producto={p} />
                  ))}
                </div>
              </section>
            )}

            {/* Sección de OFERTAS: aparece primero, como pidió el dueño. */}
            {/* id = "ofertas": destino del carrusel para las ofertas. */}
            {ofertas.length > 0 && (
              <section id="ofertas" className="mb-8 scroll-mt-20">
                <h2 className="text-xl font-bold text-marca mb-3">🔥 Ofertas</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {ofertas.map((p) => (
                    <ProductoCard key={p.id} producto={p} />
                  ))}
                </div>
              </section>
            )}

            {/* Resto del catálogo: UNA SECCIÓN POR CATEGORÍA (Pizzas,
                Empanadas, Bebidas, Postres...), en el orden que definió el
                dueño. Solo se muestran las categorías con productos. */}
            {secciones.map((sec) => (
              <section key={sec.nombre} id={`cat-${sec.nombre}`} className="mb-8 scroll-mt-20">
                <h2 className="text-xl font-bold text-marca mb-3">{capitalizar(sec.nombre)}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {sec.productos.map((p) => (
                    <ProductoCard key={p.id} producto={p} />
                  ))}
                </div>
              </section>
            ))}

            {!cargando && !error && productos.length === 0 && (
              <p>No hay productos cargados todavía.</p>
            )}
          </div>

          {items.length > 0 && (
            <aside
              ref={panelRef}
              className="mt-8 lg:mt-0 lg:w-80 lg:shrink-0 lg:sticky lg:top-20"
            >
              <div className="bg-white border rounded-xl shadow-sm p-4">
                <h2 className="font-bold text-lg mb-3 flex items-center justify-between">
                  <span>🛒 Tu pedido</span>
                  <span className="text-sm font-semibold bg-marca text-white rounded-full px-2 py-0.5">
                    {totalItems}
                  </span>
                </h2>

                <ul className="divide-y divide-gray-100">
                  {items.map((i) => (
                    <li key={i.producto.id} className="py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{i.producto.nombre}</p>
                        <p className="text-xs text-gray-500">
                          ${precioEfectivo(i.producto).toLocaleString("es-AR")} c/u
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCantidad(i.producto.id, i.cantidad - 1)}
                          className="w-7 h-7 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                          aria-label={`Quitar un ${i.producto.nombre}`}
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm">{i.cantidad}</span>
                        <button
                          onClick={() => setCantidad(i.producto.id, i.cantidad + 1)}
                          className="w-7 h-7 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                          aria-label={`Agregar un ${i.producto.nombre}`}
                        >
                          +
                        </button>
                      </div>
                      <p className="text-sm font-semibold w-20 text-right">
                        ${(precioEfectivo(i.producto) * i.cantidad).toLocaleString("es-AR")}
                      </p>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <span>Total:</span>
                  <span className="text-xl font-bold">${total.toLocaleString("es-AR")}</span>
                </div>

                <Link
                  to="/carrito"
                  className="mt-3 block text-center bg-marca text-white py-2 rounded-lg font-semibold hover:bg-marca-oscura transition"
                >
                  Confirmar pedido
                </Link>

                <button
                  onClick={clear}
                  className="mt-2 w-full text-xs text-gray-500 hover:text-marca"
                >
                  Vaciar carrito
                </button>
              </div>
            </aside>
          )}
        </div>
      </main>

      {/* Info del local (dirección, contacto, delivery) — la edita el dueño en Ajustes. */}
      <Footer />
    </div>
  );
}

// "pizza" -> "Pizza": título lindo para la sección sin guardar un "nombre
// de display" aparte en la DB (la categoría es un string único).
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Carrusel de promos (combos + ofertas) ----------
// Gira solo cada 5 s entre todos los combos y ofertas del catálogo. Tocarlo
// scrollea hasta la sección correspondiente (las cards ya están ahí, con el
// mismo tamaño que el resto). Flechas y puntos: pausa el auto-giro un rato
// (se reprograma el timeout en cada cambio de slide) y no scrollean.
function CarruselPromos({
  slides,
}: {
  slides: { tipo: "combo" | "oferta"; producto: Producto; destino: string }[];
}) {
  const [idx, setIdx] = useState(0);

  // Auto-giro: un setTimeout por slide (no setInterval) para que cada cambio
  // manual de flechas/puntos reinicie completo los 5 segundos.
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % slides.length), 5000);
    return () => clearTimeout(t);
  }, [idx, slides.length]);

  if (slides.length === 0) return null;
  const { tipo, producto: p, destino } = slides[idx];

  // Ir a la sección: los botones internos hacen stopPropagation para que un
  // click en ellos NO scrollee por accidente.
  function ir() {
    document.getElementById(destino)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="relative mb-8">
      {/* Animación de entrada del slide: keyframes locales al componente. */}
      <style>{`
        @keyframes carrusel-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: none; }
        }
        .carrusel-in { animation: carrusel-in 0.35s ease; }
      `}</style>

      <div
        key={idx} // remount por slide = la animación entra en cada giro
        onClick={ir}
        className="cursor-pointer rounded-2xl bg-marca text-white overflow-hidden flex items-center gap-4 p-4 sm:p-6 carrusel-in"
      >
        {p.imagen_url ? (
          <img
            src={p.imagen_url}
            alt={p.nombre}
            className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl object-cover shrink-0"
          />
        ) : (
          <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl bg-white/20 flex items-center justify-center text-5xl shrink-0">
            {tipo === "combo" ? "🎉" : "🔥"}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1 mb-1">
            <span className="bg-white text-marca text-xs font-bold px-2 py-0.5 rounded">
              {tipo === "combo" ? "COMBO" : "OFERTA"}
            </span>
            {p.etiqueta && (
              <span className="bg-white/20 text-xs font-semibold px-2 py-0.5 rounded">
                {p.etiqueta}
              </span>
            )}
          </div>
          <h3 className="font-bold text-lg sm:text-2xl truncate">{p.nombre}</h3>
          <p className="text-sm sm:text-base">
            ${precioEfectivo(p).toLocaleString("es-AR")}
            {tipo === "oferta" && (
              <span className="line-through ml-2 text-white/60">
                ${p.precio.toLocaleString("es-AR")}
              </span>
            )}
          </p>
          <p className="text-xs text-white/70 mt-1">
            Tocá para ver en {tipo === "combo" ? "Combos y especiales" : "Ofertas"} →
          </p>
        </div>
      </div>

      {/* Flechas (desktop) */}
      <button
        onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + slides.length) % slides.length); }}
        aria-label="Promo anterior"
        className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-gray-800 items-center justify-center shadow"
      >
        ‹
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % slides.length); }}
        aria-label="Promo siguiente"
        className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-gray-800 items-center justify-center shadow"
      >
        ›
      </button>

      {/* Puntos: uno por slide, tocás y vas directo (y reinicia los 5 s) */}
      <div className="flex justify-center gap-1.5 mt-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); setIdx(i); }}
            aria-label={`Ir a la promo ${i + 1}`}
            className={`h-2 rounded-full transition-all ${
              i === idx ? "w-5 bg-marca" : "w-2 bg-gray-300 hover:bg-gray-400"
            }`}
          />
        ))}
      </div>
    </div>
  );
}