import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearToken, getToken } from "@/api/client";
import GestionProductos from "@/pages/admin/GestionProductos";
import GestionPedidos from "@/pages/admin/GestionPedidos";
import Analisis from "@/pages/admin/Analisis";

type Tab = "productos" | "pedidos" | "analisis";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("pedidos"); // arrancamos en pedidos: lo más urgente

  // Protege la ruta: si no hay token, no debería estar acá.
  useEffect(() => {
    if (!getToken()) navigate("/admin");
  }, [navigate]);

  function logout() {
    clearToken();
    navigate("/admin");
  }

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-marca text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold">Dashboard del dueño</h1>
          <button onClick={logout} className="text-sm hover:underline">
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Tabs de navegación interna */}
      <div className="max-w-5xl mx-auto px-4 mt-4">
        <div className="flex gap-2 mb-4">
          <TabButton active={tab === "pedidos"} onClick={() => setTab("pedidos")}>
            Pedidos
          </TabButton>
          <TabButton active={tab === "productos"} onClick={() => setTab("productos")}>
            Productos
          </TabButton>
          <TabButton active={tab === "analisis"} onClick={() => setTab("analisis")}>
            Análisis
          </TabButton>
        </div>

        {/* Render condicional del tab activo */}
        {tab === "pedidos" && <GestionPedidos />}
        {tab === "productos" && <GestionProductos />}
        {tab === "analisis" && <Analisis />}
      </div>
    </div>
  );
}

// Botón de tab reutilizable.
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-semibold transition ${
        active ? "bg-marca text-white" : "bg-white border hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}