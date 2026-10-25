import { useRef, useState } from "react";
import { api } from "@/api/client";
import type { Producto } from "@/types";

// Galería de TODAS las fotos de un producto, para el panel del dueño. La usan
// las cards de admin de productos y combos (por eso es componente compartido).
// Desde acá se puede: subir una foto más (AGREGA a la galería, ya no pisa),
// marcar una como PRINCIPAL (la de las cards) y borrar una.
export default function AdminGaleriaImagenes({
  producto,
  onRecargar,
  onError,
}: {
  producto: Producto;
  onRecargar: () => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  // Fallback: producto histórico cuya foto solo existe en imagen_url y la
  // tabla todavía no tiene filas (sin backfill) — la mostramos igual, sin
  // acciones (el backend la creó al subir; por acá no la podemos borrar).
  const fotos = producto.imagenes?.length
    ? producto.imagenes
    : producto.imagen_url
      ? [{ id: -1, url: producto.imagen_url, orden: 0 }]
      : [];

  async function subir(file: File) {
    setSubiendo(true);
    try {
      await api.admin.uploadImagen(producto.id, file);
      onRecargar();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSubiendo(false);
      // Reset del input: sin esto, subir el MISMO archivo dos veces no
      // dispara el onChange (el valor no cambió).
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function borrar(imagenId: number) {
    if (imagenId === -1) return; // fallback histórico: no hay fila que borrar
    if (!confirm("¿Borrar esta foto? Se quita de la galería (la principal pasa a la siguiente).")) return;
    try {
      await api.admin.deleteImagen(producto.id, imagenId);
      onRecargar();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function marcarPrincipal(imagenId: number) {
    if (imagenId === -1) return;
    try {
      await api.admin.setImagenPrincipal(producto.id, imagenId);
      onRecargar();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className="border border-negro-borde rounded-lg p-2 bg-negro">
      <p className="text-xs font-semibold text-gray-300 mb-2">
        Fotos ({fotos.length}) — ★ = principal (la de las cards)
      </p>
      <div className="grid grid-cols-3 gap-2">
        {fotos.map((img) => {
          const esPrincipal = img.url === producto.imagen_url;
          return (
            <div key={img.id} className="relative rounded-lg overflow-hidden border border-negro-borde">
              <img src={img.url} alt="" className="w-full aspect-square object-cover" />
              {/* Franja de acciones SIEMPRE visible abajo (antes eran dos
                  botones de 24px en la esquina que se cortaban y casi no se
                  podían tocar/borrar). Targets de 28px y etiqueta legible. */}
              <div className="absolute inset-x-0 bottom-0 flex bg-black/70">
                <button
                  onClick={() => marcarPrincipal(img.id)}
                  disabled={img.id === -1 || esPrincipal}
                  title={esPrincipal ? "Foto principal" : "Hacer principal"}
                  className={`flex-1 h-7 text-[11px] font-bold flex items-center justify-center gap-0.5 transition ${
                    esPrincipal
                      ? "bg-marca text-black"
                      : "text-white hover:bg-marca hover:text-black disabled:opacity-40 disabled:hover:bg-transparent"
                  }`}
                >
                  ★{esPrincipal ? " Principal" : ""}
                </button>
                <button
                  onClick={() => borrar(img.id)}
                  disabled={img.id === -1}
                  title="Borrar foto"
                  aria-label="Borrar foto"
                  className="w-8 h-7 shrink-0 text-[11px] font-bold text-white flex items-center justify-center hover:bg-acento disabled:opacity-40 transition"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={subiendo}
        className="mt-2 w-full border border-negro-borde rounded px-2 py-1 text-xs font-semibold text-gray-300 hover:border-marca hover:text-marca transition disabled:opacity-50"
      >
        {subiendo ? "Subiendo…" : "📷 Agregar imagen"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subir(f);
        }}
      />
    </div>
  );
}