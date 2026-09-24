import { Routes, Route, Navigate } from "react-router-dom";
import Tienda from "@/pages/Tienda";
import Carrito from "@/pages/Carrito";
import Contacto from "@/pages/Contacto";
import ProductoDetalle from "@/pages/ProductoDetalle";
import AdminLogin from "@/pages/AdminLogin";
import AdminDashboard from "@/pages/AdminDashboard";

// Mapa de rutas de la SPA.
//  /              -> la tienda (catálogo público)
//  /producto/:id  -> detalle del producto (galería, gustos del combo, agregar)
//  /carrito       -> checkout (arma el mensaje de WhatsApp y guarda el pedido)
//  /contacto      -> info del local (dirección, contacto, horarios, delivery)
//  /admin         -> login del dueño (si no hay token) o dashboard (si lo hay)
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Tienda />} />
      <Route path="/producto/:id" element={<ProductoDetalle />} />
      <Route path="/carrito" element={<Carrito />} />
      <Route path="/contacto" element={<Contacto />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin/dashboard" element={<AdminDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}