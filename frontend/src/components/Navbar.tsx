import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useCart } from "@/context/CartContext";

export default function Navbar() {
  const { totalItems } = useCart();
  const navigate = useNavigate();

  // El nombre del negocio vive en la config que edita el dueño en Ajustes
  // (misma fuente que el Footer). Mientras carga (o si falla), mostramos un
  // fallback genérico para no pisar el link con un vacío.
  const [nombre, setNombre] = useState<string | null>(null);
  useEffect(() => {
    api.getConfig().then((c) => setNombre(c.nombre)).catch(() => setNombre(null));
  }, []);

  return (
    <nav className="bg-negro border-b border-negro-borde shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-xl text-marca">
           {nombre ?? "Pedidos"}
        </Link>

        <div className="flex items-center gap-4 text-gray-200">
          <Link to="/contacto" className="text-sm hover:underline hover:text-marca transition">
            Contacto
          </Link>
          <Link to="/admin" className="text-sm hover:underline hover:text-marca transition">
            Dueño
          </Link>

          <button
            onClick={() => navigate("/carrito")}
            className="relative bg-marca text-black hover:bg-marca-clara px-3 py-1.5 rounded-lg font-semibold transition"
            aria-label="Ver carrito"
          >
            🛒 Carrito
            {totalItems > 0 && (
              // Badge con la cantidad total de productos. Aparece solo si hay items.
              // Negro sobre el botón amarillo: se lee mejor que el rojo.
              <span className="absolute -top-2 -right-2 bg-negro text-white text-xs rounded-full px-1.5 py-0.5">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}