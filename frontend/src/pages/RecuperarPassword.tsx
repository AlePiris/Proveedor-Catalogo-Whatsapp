// Página pública "Olvidé mi contraseña" (/recuperar-password): pide el
// USERNAME del dueño y dispara el email de recuperación a las direcciones
// fijas que el dueño/dev configuró. Responde SIEMPRE el mismo mensaje:
// el backend nunca confirma si el usuario existe. (spec deploy §4c)
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";

export default function RecuperarPassword() {
  const [username, setUsername] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!username.trim()) {
      setError("Escribí tu usuario del panel.");
      return;
    }
    setEnviando(true);
    try {
      const { detail } = await api.recuperarPassword(username.trim());
      setMensaje(detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-negro">
      <form onSubmit={onSubmit} className="bg-negro-panel border border-negro-borde p-6 rounded-xl shadow-card w-80 space-y-4">
        <h1 className="text-xl font-display mb-1">Olvidé mi contraseña</h1>
        <p className="text-xs text-gray-400">
          Escribí tu usuario del panel y te mandamos un email con un enlace
          para cambiar la contraseña (vence a los 30 minutos).
        </p>
        <input
          className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
          placeholder="Usuario del panel"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        {error && <p className="text-acento text-sm">{error}</p>}
        {mensaje && (
          <p className="text-green-400 text-sm">{mensaje} Revisá tu correo (y el spam).</p>
        )}
        <button
          disabled={enviando}
          className="w-full bg-marca text-black py-2 rounded-lg font-bold hover:bg-marca-clara disabled:opacity-50 transition"
        >
          {enviando ? "Enviando…" : "Enviar email"}
        </button>
        <Link to="/admin" className="block text-center text-sm text-gray-500 hover:text-marca transition">
          ← Volver al login
        </Link>
      </form>
    </div>
  );
}