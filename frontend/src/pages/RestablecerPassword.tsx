// Página pública de restablecimiento (/restablecer-password?token=...):
// llega desde el link del email de recuperación. Consume el token (un solo
// uso) y cambia la contraseña del dueño. (spec deploy §4c)
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";

export default function RestablecerPassword() {
  const [searchParams] = useSearchParams();
  // El token viene en la query del link del email. Sin token no hay nada que
  // restablecer: lo mostramos en vez de dejar submittear al vacío.
  const token = searchParams.get("token") ?? "";

  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    if (nueva.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (nueva !== repetir) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      const { detail } = await api.restablecerPassword(token, nueva);
      setOkMsg(detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-negro">
      <form onSubmit={onSubmit} className="bg-negro-panel border border-negro-borde p-6 rounded-xl shadow-card w-80 space-y-4">
        <h1 className="text-xl font-display mb-1">Restablecer contraseña</h1>

        {!token ? (
          <>
            <p className="text-sm text-gray-400">El enlace no incluye el token de recuperación.</p>
            <Link to="/recuperar-password" className="block text-center text-sm text-marca hover:underline">
              Pedir otro email
            </Link>
          </>
        ) : okMsg ? (
          <>
            <p className="text-green-400 text-sm">{okMsg}</p>
            <Link to="/admin" className="block text-center bg-marca text-black py-2 rounded-lg font-bold hover:bg-marca-clara transition">
              Ir al login
            </Link>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-400">
              Elegí tu nueva contraseña (mínimo 8 caracteres). El enlace de este email se desactiva al usarlo.
            </p>
            <input
              type="password"
              className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
              placeholder="Nueva contraseña"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              autoComplete="new-password"
            />
            <input
              type="password"
              className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500"
              placeholder="Repetir nueva contraseña"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
              autoComplete="new-password"
            />
            {error && <p className="text-acento text-sm">{error}</p>}
            <button
              disabled={enviando}
              className="w-full bg-marca text-black py-2 rounded-lg font-bold hover:bg-marca-clara disabled:opacity-50 transition"
            >
              {enviando ? "Restableciendo…" : "Restablecer"}
            </button>
            <Link to="/admin" className="block text-center text-sm text-gray-500 hover:text-marca transition">
              ← Volver al login
            </Link>
          </>
        )}
      </form>
    </div>
  );
}