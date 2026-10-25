// Modales PROPIOS del tema (spec deploy §5.4): reemplazan los confirm()/prompt()
// nativos del navegador, que en producción mostrarían "localhost:5173 dice:"
// (o la URL de Vercel) encima del diálogo — rompe la estética y no se puede
// estilizar. ConfirmModal para confirmaciones (destructivas en rojo),
// ModalInput para pedir un valor prellenado (oferta, renombrar).
//
// Ambos: overlay con click fuera y teclas Esc / Enter; foco inicial en el
// botón de confirmar (ConfirmModal) o el input (ModalInput).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

function Overlay({ children, onCerrar }: { children: ReactNode; onCerrar: () => void }) {
  // Esc = cancelar. Enter NO acá: cada modal decide (el input con multilinea
  // no quiere Enter-confirmar; el simple sí).
  useEffect(() => {
    function teclas(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [onCerrar]);

  return (
    // Click en el FONDO (el propio overlay) cierra; el contenido hace
    // stopPropagation para que un click adentro no cerré el modal.
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCerrar}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="bg-negro-panel border border-negro-borde rounded-xl shadow-card p-5 w-full max-w-sm space-y-3"
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({
  titulo,
  mensaje,
  onConfirmar,
  onCancelar,
  textoConfirmar = "Confirmar",
  peligroso = false,
}: {
  titulo: string;
  mensaje: string;
  onConfirmar: () => void;
  onCancelar: () => void;
  textoConfirmar?: string;
  peligroso?: boolean; // true = acción destructiva: el botón es rojo (acento)
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    function enter(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.stopPropagation();
        onConfirmar();
      }
    }
    window.addEventListener("keydown", enter);
    return () => window.removeEventListener("keydown", enter);
  }, [onConfirmar]);

  return (
    <Overlay onCerrar={onCancelar}>
      <h2 className="font-display text-lg">{titulo}</h2>
      <p className="text-sm text-gray-300">{mensaje}</p>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancelar}
          className="border border-negro-borde px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:text-marca hover:border-marca/40 transition"
        >
          Cancelar
        </button>
        <button
          ref={btnRef}
          onClick={onConfirmar}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition active:scale-[0.98] ${
            peligroso ? "bg-acento hover:bg-red-500" : "bg-marca text-black hover:bg-marca-clara"
          }`}
        >
          {textoConfirmar}
        </button>
      </div>
    </Overlay>
  );
}

export function ModalInput({
  titulo,
  mensaje,
  inicial,
  onConfirmar,
  onCancelar,
  type = "text",
}: {
  titulo: string;
  mensaje: string;
  inicial: string;
  onConfirmar: (valor: string) => void;
  onCancelar: () => void;
  type?: string; // "text" | "number" (ej. precio de oferta usa number)
}) {
  const [valor, setValor] = useState(inicial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // select(): al abrir, el texto EXISTENTE queda seleccionado — reemplazar
    // es empezar a escribir, no borrar a mano.
    inputRef.current?.select();
  }, []);

  function confirmar() {
    onConfirmar(valor);
  }

  return (
    <Overlay onCerrar={onCancelar}>
      <h2 className="font-display text-lg">{titulo}</h2>
      {mensaje && <p className="text-sm text-gray-300">{mensaje}</p>}
      <input
        ref={inputRef}
        type={type}
        className="w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            confirmar();
          }
        }}
      />
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancelar}
          className="border border-negro-borde px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:text-marca hover:border-marca/40 transition"
        >
          Cancelar
        </button>
        <button
          onClick={confirmar}
          className="bg-marca text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-marca-clara active:scale-[0.98] transition"
        >
          Guardar
        </button>
      </div>
    </Overlay>
  );
}