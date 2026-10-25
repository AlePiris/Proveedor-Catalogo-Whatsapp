import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useCart } from "@/context/CartContext";

export default function Navbar() {
  const { totalItems } = useCart();
  const navigate = useNavigate();

  // El nombre y el logo del local viven en la config que edita el dueño en
  // Ajustes (misma fuente que el Footer). Mientras carga (o si falla), mostramos
  // un fallback genérico para no pisar el link con un vacío.
  const [nombre, setNombre] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        setNombre(c.nombre);
        setLogo(c.logo_url || null);
        // Bonus barato: el mismo logo sirve de favicon de la pestaña. El link
        // va en index.html con id fijo; solo lo re-apuntamos si hay imagen.
        if (c.logo_url) {
          const link = document.getElementById("favicon") as HTMLLinkElement | null;
          if (link) link.href = c.logo_url;
        }
      })
      .catch(() => setNombre(null));
  }, []);

  return (
    <nav className="sticky top-0 z-40 bg-negro/85 backdrop-blur-md border-b border-negro-borde/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5 min-w-0 group">
          {/* Logo del local SOLO si el dueño subió una imagen (la imagen es el
              interruptor). Va sobre un chip blanco porque el logo es de fondo
              claro y sobre negro se leería pobre. */}
          {logo && (
            <img
              src={logo}
              alt=""
              className="w-10 h-10 rounded-xl bg-white object-contain p-0.5 shadow-sm ring-1 ring-white/10 transition group-hover:scale-105"
            />
          )}
          <span
            className={`font-display text-marca leading-tight ${
              logo ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"
            }`}
          >
            {nombre ?? "Pedidos"}
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-5 text-gray-300">
          <Link
            to="/contacto"
            className="hidden sm:block text-sm font-semibold hover:text-marca transition-colors"
          >
            Contacto
          </Link>
          <Link
            to="/admin"
            className="hidden sm:block text-sm font-semibold hover:text-marca transition-colors"
          >
            Dueño
          </Link>

          <button
            onClick={() => navigate("/carrito")}
            className="relative bg-marca text-black hover:bg-marca-clara active:scale-95 px-3 py-1.5 rounded-lg font-bold text-sm shadow-[0_0_18px_rgba(255,210,48,0.25)] hover:shadow-[0_0_26px_rgba(255,210,48,0.4)] transition-all"
            aria-label="Ver carrito"
          >
            🛒 Carrito
            {totalItems > 0 && (
              // Badge con la cantidad total de productos. Aparece solo si hay items.
              // Negro sobre el botón amarillo: se lee mejor que el rojo.
              <span className="absolute -top-2 -right-2 bg-negro text-white text-xs rounded-full px-1.5 py-0.5 ring-1 ring-white/20">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}