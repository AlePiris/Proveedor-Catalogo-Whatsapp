// Pestaña Ajustes del dashboard: el dueño edita los datos del local
// (nombre, dirección, contacto, radio de delivery, horarios, descripción)
// y sube/quita el LOGO (la imagen es el interruptor: sin subida no hay logo).
// Todo lo que carga acá lo muestran el footer, /contacto y el carrito.
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { LocalConfig } from "@/types";

// Estado del form: arranca vacío y se llena con lo que trae GET /api/config.
const VACIO: LocalConfig = {
  nombre: "",
  direccion: "",
  telefono: "",
  whatsapp: "",
  radio_delivery_km: 0,
  horarios: "",
  descripcion: "",
  logo_url: "",
};

export default function Ajustes() {
  const [form, setForm] = useState<LocalConfig>(VACIO);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Subida/borrado del logo en curso (feedback en el botón mientras viaja).
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  // Abrir el file picker programáticamente (el input va escondido detrás del botón).
  const inputLogoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setForm)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);

  // Helper para editar un campo del form sin repetir el spread a mano.
  function set<K extends keyof LocalConfig>(campo: K, valor: LocalConfig[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setOkMsg(null); // si toca algo, se borra el "guardado" anterior
  }

  async function guardar() {
    setError(null);
    setOkMsg(null);
    // Validaciones mínimas del lado del dueño (el backend revalida igual).
    if (!form.nombre.trim()) {
      setError("El nombre del local no puede quedar vacío.");
      return;
    }
    if (form.radio_delivery_km < 0) {
      setError("El radio de delivery no puede ser negativo.");
      return;
    }
    if (form.whatsapp && !/^\d+$/.test(form.whatsapp.trim())) {
      setError("El WhatsApp solo debe tener números (formato internacional sin +, ej. 5491100000000).");
      return;
    }

    setGuardando(true);
    try {
      const guardado = await api.admin.updateConfig({
        nombre: form.nombre.trim(),
        direccion: form.direccion.trim(),
        telefono: form.telefono.trim(),
        whatsapp: form.whatsapp.trim(),
        radio_delivery_km: form.radio_delivery_km,
        horarios: form.horarios.trim(),
        descripcion: form.descripcion.trim(),
      });
      setForm(guardado);
      setOkMsg("Guardado ✓ Ya se ve en la web (footer, contacto y carrito).");
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function subirLogo(file: File | undefined) {
    if (!file) return;
    // Validación temprana (el backend revalida): solo imágenes, hasta 5 MB.
    if (!file.type.startsWith("image/")) {
      setError("El logo debe ser una imagen (PNG, JPG...).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("La imagen del logo supera los 5 MB.");
      return;
    }
    setError(null);
    setOkMsg(null);
    setSubiendoLogo(true);
    try {
      const guardado = await api.admin.uploadLogo(file);
      setForm((f) => ({ ...f, logo_url: guardado.logo_url }));
      setOkMsg("Logo actualizado ✓ Ya se ve en la web (Navbar, Footer y favicon).");
    } catch (e) {
      setError((e as Error).message || "No se pudo subir el logo.");
    } finally {
      setSubiendoLogo(false);
      // Permite volver a elegir el MISMO archivo más adelante (si no, el
      // evento change no dispara de nuevo para el mismo input.value).
      if (inputLogoRef.current) inputLogoRef.current.value = "";
    }
  }

  async function quitarLogo() {
    setError(null);
    setOkMsg(null);
    setSubiendoLogo(true);
    try {
      const guardado = await api.admin.borrarLogo();
      setForm((f) => ({ ...f, logo_url: guardado.logo_url }));
      setOkMsg("Logo quitado ✓ La web vuelve a mostrar solo el nombre.");
    } catch (e) {
      setError((e as Error).message || "No se pudo quitar el logo.");
    } finally {
      setSubiendoLogo(false);
    }
  }

  if (cargando) return <p className="text-gray-300">Cargando ajustes…</p>;

  const inputCls = "w-full border border-negro-borde bg-negro text-gray-100 placeholder:text-gray-500 rounded-lg px-3 py-2";
  const labelCls = "text-sm font-semibold text-gray-300";

  return (
    <div className="bg-negro-panel border border-negro-borde rounded-xl p-4 sm:p-6 space-y-4 text-gray-200">
      <div>
        <h2 className="font-bold text-lg text-gray-100">Ajustes del local</h2>
        <p className="text-sm text-gray-400">
          Todo lo que cargues acá se publica en la página de Contacto, el footer de la tienda
          y los detalles del delivery en el carrito. Lo podés cambiar cuando quieras.
        </p>
      </div>

      {error && <p className="text-marca text-sm">{error}</p>}
      {okMsg && <p className="text-green-400 text-sm">{okMsg}</p>}

      {/* LOGO del local: la imagen ES el interruptor. Sin subida, la web
          muestra solo el nombre (nada cambia); con imagen, el logo aparece
          en el Navbar, el Footer y el favicon del navegador. */}
      <div className="border border-negro-borde rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="w-20 h-20 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">
          {form.logo_url ? (
            <img src={form.logo_url} alt="Logo del local" className="w-full h-full object-contain p-1" />
          ) : (
            <span className="text-3xl" aria-hidden>🏪</span>
          )}
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold text-gray-300">Logo del local</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {form.logo_url
              ? "Se muestra en el Navbar, el Footer y el favicon. Subir una nueva reemplaza la anterior."
              : "Sin imagen no hay logo: la web muestra solo el nombre. Subí una y aparece solo."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputLogoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => subirLogo(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputLogoRef.current?.click()}
            disabled={subiendoLogo}
            className="bg-marca text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-marca-clara disabled:opacity-50 transition"
          >
            {subiendoLogo ? "Subiendo…" : form.logo_url ? "Reemplazar logo" : "Subir logo"}
          </button>
          {form.logo_url && (
            <button
              type="button"
              onClick={quitarLogo}
              disabled={subiendoLogo}
              className="border border-negro-borde px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:text-marca hover:border-marca/40 disabled:opacity-50 transition"
            >
              Quitar logo
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Nombre del local</label>
          <input
            className={inputCls}
            value={form.nombre}
            onChange={(e) => set("nombre", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Dirección</label>
          <input
            className={inputCls}
            placeholder="Calle, número, ciudad"
            value={form.direccion}
            onChange={(e) => set("direccion", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Teléfono</label>
          <input
            className={inputCls}
            placeholder="11 5555-5555"
            value={form.telefono}
            onChange={(e) => set("telefono", e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>WhatsApp que recibe los pedidos</label>
          <input
            className={inputCls}
            placeholder="5491100000000 (sin +, sin espacios)"
            value={form.whatsapp}
            onChange={(e) => set("whatsapp", e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            Si lo dejas vacío se usa el número de la configuración general.
          </p>
        </div>

        {/* Radio de delivery: 0 = deshabilitado. El alcance real lo confirma
            el proveedor por WhatsApp (es informativo, no hay GPS). */}
        <div>
          <label className={labelCls}>Radio de delivery</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={50}
              className={`${inputCls} w-24`}
              value={form.radio_delivery_km}
              onChange={(e) => set("radio_delivery_km", parseInt(e.target.value || "0", 10) || 0)}
            />
            <span className="text-sm text-gray-300">km a la redonda del local</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Informativo: se muestra en Contacto. El envío a locales no depende de este valor.
          </p>
        </div>
      </div>

      <div>
        <label className={labelCls}>Horarios</label>
        <input
          className={inputCls}
          placeholder="Ej: Lun a Dom de 19:00 a 23:00"
          value={form.horarios}
          onChange={(e) => set("horarios", e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls}>Descripción</label>
        <textarea
          className={inputCls}
          rows={2}
          placeholder="Un párrafo corto sobre el negocio (ej: barritas de cereal artesanales…)"
          value={form.descripcion}
          onChange={(e) => set("descripcion", e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={guardar}
          disabled={guardando}
          className="bg-marca text-black px-6 py-2 rounded-lg font-semibold hover:bg-marca-clara disabled:opacity-50 transition"
        >
          {guardando ? "Guardando…" : "Guardar ajustes"}
        </button>
      </div>
    </div>
  );
}