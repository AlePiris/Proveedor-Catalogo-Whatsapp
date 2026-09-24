import { BrowserRouter } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import AppRoutes from "@/router";
import WhatsAppFlotante from "@/components/WhatsAppFlotante";

// App = el esqueleto que envuelve todo.
//  - BrowserRouter: habilita el enrutado del lado del cliente (cambia la URL sin
//    recargar la página).
//  - CartProvider: el carrito está disponible para cualquier componente bajo él.
//  - WhatsAppFlotante: círculo fijo abajo a la derecha en TODAS las páginas.
export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <AppRoutes />
        <WhatsAppFlotante />
      </CartProvider>
    </BrowserRouter>
  );
}