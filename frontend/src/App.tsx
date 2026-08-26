import { BrowserRouter } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import AppRoutes from "@/router";

// App = el esqueleto que envuelve todo.
//  - BrowserRouter: habilita el enrutado del lado del cliente (cambia la URL sin
//    recargar la página).
//  - CartProvider: el carrito está disponible para cualquier componente bajo él.
export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <AppRoutes />
      </CartProvider>
    </BrowserRouter>
  );
}