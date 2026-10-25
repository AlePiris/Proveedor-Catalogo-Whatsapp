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

  return (
    <div className="min-h-full bg-negro">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="font-display text-2xl sm:text-3xl uppercase text-gray-100 mb-5 tracking-tight">
          Nuestros productos
        </h1>

        {/* Carruseles de promos arriba de todo: UNO de combos y OTRO de
            ofertas (antes era un solo banner que mezclaba ambos). Cada uno
            gira solo entre sus productos; tocarlo scrollea hasta su sección,
            que vive al final de la página, después de las categorías. */}
        <style>{`
          @keyframes carrusel-in {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: none; }
          }
          .carrusel-in { animation: carrusel-in 0.35s ease; }
        `}</style>
        {combos.length > 0 && (
          <CarruselPromos
            tipo="combo"
            titulo="Combos y especiales"
            productos={combos}
            destino="combos"
          />
        )}
        {ofertas.length > 0 && (
          <CarruselPromos
            tipo="oferta"
            titulo="Ofertas"
            productos={ofertas}
            destino="ofertas"
          />
        )}

        {cargando && <p className="text-gray-300">Cargando…</p>}
        {error && <p className="text-marca">Error: {error}</p>}

        {/* Flex: en desktop los productos a la izquierda y el panel del pedido
            fijo a la derecha (sticky). En mobile se apilan: grilla arriba,
            panel debajo. Solo se muestra cuando hay algo en el carrito. */}
        <div className="lg:flex lg:items-start lg:gap-6">
          <div className="flex-1 min-w-0">
            {/* Catálogo: UNA SECCIÓN POR CATEGORÍA (Barritas, Proteicas,
                Zero, Bebidas...), en el orden que definió el dueño. Van
                PRIMERO en la página; combos y ofertas están al final. Solo
                se muestran las categorías con productos. */}
            {secciones.map((sec) => (
              <section key={sec.nombre} id={`cat-${sec.nombre}`} className="mb-10 scroll-mt-20">
                <SeccionTitulo titulo={capitalizar(sec.nombre)} />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {sec.productos.map((p) => (
                    <ProductoCard key={p.id} producto={p} />
                  ))}
                </div>
              </section>
            ))}

            {/* Sección de COMBOS: al final de la página, después de las
                categorías (como pidió el dueño). id="combos": es a donde
                scrollea el carrusel de arriba. Cards del MISMO tamaño que
                el resto del catálogo. */}
            {combos.length > 0 && (
              <section id="combos" className="mb-10 scroll-mt-20">
                <SeccionTitulo titulo="Combos y especiales" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {combos.map((p) => (
                    <ProductoCard key={p.id} producto={p} />
                  ))}
                </div>
              </section>
            )}

            {/* Sección de OFERTAS: después de los combos. id="ofertas":
                destino del carrusel de ofertas de arriba. */}
            {ofertas.length > 0 && (
              <section id="ofertas" className="mb-10 scroll-mt-20">
                <SeccionTitulo titulo="Ofertas" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {ofertas.map((p) => (
                    <ProductoCard key={p.id} producto={p} />
                  ))}
                </div>
              </section>
            )}

            {!cargando && !error && productos.length === 0 && (
              <p className="text-gray-300">No hay productos cargados todavía.</p>
            )}
          </div>

          {items.length > 0 && (
            <aside
              ref={panelRef}
              className="mt-8 lg:mt-0 lg:w-80 lg:shrink-0 lg:sticky lg:top-20"
            >
              <div className="bg-negro-panel border border-negro-borde rounded-xl shadow-card p-4 text-gray-200">
                <h2 className="font-display text-base uppercase tracking-tight mb-3 flex items-center justify-between">
                  <span>🛒 Tu pedido</span>
                  <span className="text-sm font-bold bg-marca text-white rounded-full px-2 py-0.5">
                    {totalItems}
                  </span>
                </h2>

                <ul className="divide-y divide-negro-borde">
                  {items.map((i) => (
                    <li key={i.producto.id} className="py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{i.producto.nombre}</p>
                        <p className="text-xs text-gray-400">
                          ${precioEfectivo(i.producto).toLocaleString("es-AR")} c/u
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCantidad(i.producto.id, i.cantidad - 1)}
                          className="w-7 h-7 rounded bg-negro-sub hover:bg-gray-600 text-sm font-bold active:scale-95 transition"
                          aria-label={`Quitar un ${i.producto.nombre}`}
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{i.cantidad}</span>
                        <button
                          onClick={() => setCantidad(i.producto.id, i.cantidad + 1)}
                          className="w-7 h-7 rounded bg-negro-sub hover:bg-gray-600 text-sm font-bold active:scale-95 transition"
                          aria-label={`Agregar un ${i.producto.nombre}`}
                        >
                          +
                        </button>
                      </div>
                      <p className="text-sm font-bold w-20 text-right">
                        ${(precioEfectivo(i.producto) * i.cantidad).toLocaleString("es-AR")}
                      </p>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-negro-borde">
                  <span className="text-gray-400 font-semibold">Total:</span>
                  <span className="text-xl font-extrabold text-marca">${total.toLocaleString("es-AR")}</span>
                </div>

                <Link
                  to="/carrito"
                  className="mt-3 block text-center bg-marca text-black py-2 rounded-lg font-bold hover:bg-marca-clara active:scale-[0.98] hover:shadow-glow transition-all"
                >
                  Confirmar pedido
                </Link>

                <button
                  onClick={clear}
                  className="mt-2 w-full text-xs text-gray-500 hover:text-marca transition-colors"
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

// "barritas" -> "Barritas": título lindo para la sección sin guardar un "nombre
// de display" aparte en la DB (la categoría es un string único).
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Título de sección con la barra de marca: el mismo lenguaje en todas las
// secciones (categorías, combos, ofertas), sin emojis decorativos.
function SeccionTitulo({ titulo }: { titulo: string }) {
  return (
    <h2 className="flex items-center gap-2.5 mb-4">
      <span className="h-1.5 w-7 rounded-full bg-marca shrink-0" aria-hidden />
      <span className="font-display text-lg sm:text-xl uppercase tracking-tight text-gray-100">
        {titulo}
      </span>
    </h2>
  );
}

// ---------- Carrusel de promos (banner) ----------
// El banner grande de siempre (fondo marca, gira solo cada 5 s), pero ahora
// UNO POR SECCIÓN: recibe sus productos (solo combos o solo ofertas) y el id
// de la sección a donde scrollea al tocarlo. Flechas y puntos: cambian de
// slide y reinician el auto-giro; no scrollean.
function CarruselPromos({
  tipo,
  titulo,
  productos,
  destino,
}: {
  tipo: "combo" | "oferta";
  titulo: string;
  productos: Producto[];
  destino: string;
}) {
  const [idx, setIdx] = useState(0);

  // Auto-giro: un setTimeout por slide (no setInterval) para que cada cambio
  // manual de flechas/puntos reinicie completo los 5 segundos.
  useEffect(() => {
    if (productos.length <= 1) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % productos.length), 5000);
    return () => clearTimeout(t);
  }, [idx, productos.length]);

  if (productos.length === 0) return null;
  const p = productos[idx];

  // Ir a la sección: los botones internos hacen stopPropagation para que un
  // click en ellos NO scrollee por accidente.
  function ir() {
    document.getElementById(destino)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="relative mb-8">
      <div
        key={idx} // remount por slide = la animación entra en cada giro
        onClick={ir}
        className="cursor-pointer rounded-2xl border border-marca/25 bg-gradient-to-r from-negro-panel via-negro-panel to-negro shadow-card overflow-hidden flex items-center gap-4 p-4 sm:p-5 hover:border-marca/50 transition-colors carrusel-in"
      >
        {p.imagen_url ? (
          <img
            src={p.imagen_url}
            alt={p.nombre}
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover shrink-0 ring-1 ring-white/10"
          />
        ) : (
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-white/5 flex items-center justify-center text-5xl shrink-0">
            {tipo === "combo" ? "🎉" : "🔥"}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="bg-marca text-black text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full">
              {tipo === "combo" ? "Combo" : "Oferta"}
            </span>
            {p.etiqueta && (
              <span className="border border-marca/40 text-marca text-[11px] font-bold px-2 py-0.5 rounded-full">
                {p.etiqueta}
              </span>
            )}
          </div>
          <h3 className="font-bold text-sm sm:text-lg text-gray-100 truncate">{p.nombre}</h3>
          <p className="text-lg sm:text-xl font-extrabold text-marca">
            ${precioEfectivo(p).toLocaleString("es-AR")}
            {tipo === "oferta" && (
              <span className="line-through ml-2 text-gray-500 text-sm font-semibold">
                ${p.precio.toLocaleString("es-AR")}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-1">Tocá para ver en {titulo} →</p>
        </div>
      </div>

      {/* Flechas (desktop): chicas y semitransparente sobre el banner. */}
      {productos.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setIdx((idx - 1 + productos.length) % productos.length); }}
            aria-label="Promo anterior"
            className="hidden sm:flex absolute left-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white text-sm border border-white/20 backdrop-blur-sm hover:bg-black/70 hover:border-marca/50 items-center justify-center transition"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIdx((idx + 1) % productos.length); }}
            aria-label="Promo siguiente"
            className="hidden sm:flex absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white text-sm border border-white/20 backdrop-blur-sm hover:bg-black/70 hover:border-marca/50 items-center justify-center transition"
          >
            ›
          </button>

          {/* Puntos: uno por slide, tocás y vas directo (y reinicia los 5 s) */}
          <div className="flex justify-center gap-1.5 mt-2">
            {productos.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setIdx(i); }}
                aria-label={`Ir a la promo ${i + 1}`}
                className={`h-2 rounded-full transition-all ${
                  i === idx ? "w-5 bg-marca" : "w-2 bg-gray-600 hover:bg-gray-500"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}