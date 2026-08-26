import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
    <div className="min-h-full flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="bg-white p-6 rounded-xl shadow-md w-80 space-y-4">
        <h1 className="text-xl font-bold text-center">Acceso del dueño</h1>
        <input
          className="w-full border rounded-lg px-3 py-2"
          placeholder="Usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          className="w-full border rounded-lg px-3 py-2"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-marca text-sm">{error}</p>}
        <button className="w-full bg-marca text-white py-2 rounded-lg font-semibold hover:bg-marca-oscura">
          Entrar
        </button>
        <p className="text-xs text-gray-400 text-center">Demo: admin / admin123</p>
      </form>
    </div>
  );
}