import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import type { Producto } from "@/types";
import { precioEfectivo } from "@/types";

// Un item del carrito guarda el producto entero (para mostrar nombre/precio) y
// la cantidad. Guardar el producto completo evita volver a pedirlo a la API
// al renderizar el carrito.
export interface CartItem {
  producto: Producto;
  cantidad: number;
}

interface CartState {
  items: CartItem[];
}

// Todas las acciones que modifican el carrito pasan por acá. Esto centraliza la
// lógica: el componente solo despacha una acción, no toca el estado directamente.
type Action =
  | { type: "ADD"; producto: Producto; cantidad?: number }
  | { type: "REMOVE"; productoId: number }
  | { type: "SET_CANTIDAD"; productoId: number; cantidad: number }
  | { type: "CLEAR" }
  | { type: "HYDRATE"; items: CartItem[] }; // cargar desde localStorage al iniciar

const STORAGE_KEY = "pizzeria_cart";

function reducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case "HYDRATE":
      return { items: action.items };
    case "ADD": {
      const qty = action.cantidad ?? 1;
      const existing = state.items.find((i) => i.producto.id === action.producto.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.producto.id === action.producto.id ? { ...i, cantidad: i.cantidad + qty } : i
          ),
        };
      }
      return { items: [...state.items, { producto: action.producto, cantidad: qty }] };
    }
    case "REMOVE":
      return { items: state.items.filter((i) => i.producto.id !== action.productoId) };
    case "SET_CANTIDAD":
      // Si la cantidad llega a 0, quitamos el item (no tiene sentido pedir 0).
      if (action.cantidad <= 0) {
        return { items: state.items.filter((i) => i.producto.id !== action.productoId) };
      }
      return {
        items: state.items.map((i) =>
          i.producto.id === action.productoId ? { ...i, cantidad: action.cantidad } : i
        ),
      };
    case "CLEAR":
      return { items: [] };
    default:
      return state;
  }
}

interface CartContextValue {
  items: CartItem[];
  add: (producto: Producto, cantidad?: number) => void;
  remove: (productoId: number) => void;
  setCantidad: (productoId: number, cantidad: number) => void;
  clear: () => void;
  totalItems: number;     // suma de cantidades (para el badge del carrito)
  total: number;          // suma en $ usando el precio efectivo (oferta o normal)
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [] });

  // Al montar, cargamos el carrito guardado (si hay). try/catch porque localStorage
  // puede fallar (modo privado, storage lleno) y no queremos romper la app.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "HYDRATE", items: JSON.parse(raw) });
    } catch {
      /* ignore: si está corrupto, arrancamos con carrito vacío */
    }
  }, []);

  // Cada vez que cambia el carrito, lo guardamos. Así sobrevive a recargas.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    } catch {
      /* ignore */
    }
  }, [state.items]);

  const totalItems = state.items.reduce((s, i) => s + i.cantidad, 0);
  const total = state.items.reduce((s, i) => s + precioEfectivo(i.producto) * i.cantidad, 0);

  const value: CartContextValue = {
    items: state.items,
    add: (producto, cantidad) => dispatch({ type: "ADD", producto, cantidad }),
    remove: (productoId) => dispatch({ type: "REMOVE", productoId }),
    setCantidad: (productoId, cantidad) => dispatch({ type: "SET_CANTIDAD", productoId, cantidad }),
    clear: () => dispatch({ type: "CLEAR" }),
    totalItems,
    total,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// Hook para consumir el carrito. Lanza error si se usa fuera del provider
// (protege contra bugs de wiring).
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return ctx;
}