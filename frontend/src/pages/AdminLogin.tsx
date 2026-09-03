import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken, getToken } from "@/api/client";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Si ya hay token, no tiene sentido mostrar el login: vamos al dashboard.
  // Usamos useEffect (no durante el render) para no disparar efectos colaterales
  // en medio del pintado.
  useEffect(() => {
    if (getToken()) navigate("/admin/dashboard");
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { access_token } = await api.login(username, password);
      setToken(access_token); // lo guarda en localStorage
      navigate("/admin/dashboard");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-negro">
      <form onSubmit={onSubmit} className="bg-negro-panel border border-negro-borde p-6 rounded-xl shadow-md w-80 space-y-4">
        <h1 className="text-xl font-bold text-center text-marca">Acceso del dueño</h1>
        <input
          className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
          placeholder="Usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-acento text-sm">{error}</p>}
        <button className="w-full bg-marca text-black py-2 rounded-lg font-semibold hover:bg-marca-clara">
          Entrar
        </button>
        <Link
          to="/"
          className="block text-center text-sm text-gray-500 hover:text-marca"
        >
          ← Volver a la tienda
        </Link>
        <p className="text-xs text-gray-500 text-center">Demo: admin / admin123</p>
      </form>
    </div>
  );
}