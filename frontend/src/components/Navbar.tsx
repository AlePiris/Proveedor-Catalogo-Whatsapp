import { Link, useNavigate } from "react-router-dom";
import { useCart } from "@/context/CartContext";

export default function Navbar() {
  const { totalItems } = useCart();
  const navigate = useNavigate();

  return (
    <nav className="bg-marca text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-xl">
          🍕 Pizzería El Gordito
        </Link>

        <div className="flex items-center gap-4">
          <Link to="/contacto" className="text-sm hover:underline opacity-90">
            Contacto
          </Link>
          <Link to="/admin" className="text-sm hover:underline opacity-90">
            Dueño
          </Link>

          <button
            onClick={() => navigate("/carrito")}
            className="relative bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg transition"
            aria-label="Ver carrito"
          >
            🛒 Carrito
            {totalItems > 0 && (
              // Badge con la cantidad total de productos. Aparece solo si hay items.
              <span className="absolute -top-2 -right-2 bg-black text-white text-xs rounded-full px-1.5 py-0.5">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}