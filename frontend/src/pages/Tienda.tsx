import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Producto } from "@/types";
import Navbar from "@/components/Navbar";
import ProductoCard from "@/components/ProductoCard";

export default function Tienda() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Al montar, pedimos los productos. El backend ya los devuelve ordenados
  // (ofertas primero), pero acá los separamos en dos secciones para mostrarlas.
  useEffect(() => {
    api
      .getProductos()
      .then((data) => setProductos(data))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  const ofertas = productos.filter((p) => p.en_oferta);
  const resto = productos.filter((p) => !p.en_oferta);

  return (
    <div className="min-h-full bg-gray-50">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Nuestros productos</h1>

        {cargando && <p>Cargando…</p>}
        {error && <p className="text-marca">Error: {error}</p>}

        {/* Sección de OFERTAS: aparece primero, como pidió el dueño. */}
        {ofertas.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-bold text-marca mb-3">🔥 Ofertas</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {ofertas.map((p) => (
                <ProductoCard key={p.id} producto={p} />
              ))}
            </div>
          </section>
        )}

        {/* Resto del catálogo. */}
        {resto.length > 0 && (
          <section>
            <h2 className="text-xl font-bold mb-3">Productos</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {resto.map((p) => (
                <ProductoCard key={p.id} producto={p} />
              ))}
            </div>
          </section>
        )}

        {!cargando && !error && productos.length === 0 && (
          <p>No hay productos cargados todavía.</p>
        )}
      </main>
    </div>
  );
}