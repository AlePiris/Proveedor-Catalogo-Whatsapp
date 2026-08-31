// Pestaña Combos del dashboard: el dueño arma combos (ej: "6 empanadas + 2
// gaseosas") eligiendo productos del catálogo con cantidades y poniendo el
// precio del combo. La etiqueta libre le sirve para promos de días festivos
// ("🍻 Día del Amigo") y el toggle Activo para apagar la promo al otro día.
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Producto } from "@/types";

// Fila del editor de componentes: guarda el producto elegido + cantidad.
// Usamos `key` local porque dos filas podrían tener (por un instante) los
// mismos datos y React necesita claves únicas.
interface FilaComponente {
  key: number;
  producto_id: number;
  cantidad: number;
  nombre: string;
  precio_unitario: number;
}

const nuevoKey = () => Date.now() - Math.random();

export default function Combos() {
  const [combos, setCombos] = useState<Producto[]>([]);       // TODOS (activos y apagados)
  const [productos, setProductos] = useState<Producto[]>([]); // componentes posibles (simples)
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -------- Form "nuevo combo" --------
  const [nuevo, setNuevo] = useState({ nombre: "", descripcion: "", precio: "", etiqueta: "", stock: "10" });
  const [componentes, setComponentes] = useState<FilaComponente[]>([]);
  const [selActual, setSelActual] = useState(0);   // producto elegido en el select (0 = nada)
  const [cantActual, setCantActual] = useState(1); // cantidad de ese componente
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const todos = await api.admin.getProductos();
      setCombos(todos.filter((p) => p.categoria === "combo"));
      // Los posibles componentes son productos SIMPLES del catálogo.
      setProductos(todos.filter((p) => p.categoria !== "combo"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  // Precio de referencia: cuánto costarían los componentes sueltos.
  const precioCombo = parseFloat(nuevo.precio);
  const totalSuelto = componentes.reduce((s, f) => s + f.cantidad * f.precio_unitario, 0);

  function agregarComponente() {
    setError(null);
    const prod = productos.find((p) => p.id === selActual);
    if (!prod || cantActual < 1) {
      setError("Elegí el producto y la cantidad (mínimo 1) del componente.");
      return;
    }
    if (componentes.some((f) => f.producto_id === prod.id)) {
      setError(`"${prod.nombre}" ya está en el combo (podés cambiar la cantidad ahí).`);
      return;
    }
    setComponentes([
      ...componentes,
      { key: nuevoKey(), producto_id: prod.id, cantidad: cantActual, nombre: prod.nombre, precio_unitario: prod.precio },
    ]);
    setSelActual(0); // listo para elegir el próximo
    setCantActual(1);
  }

  async function crearCombo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (componentes.length === 0) {
      setError("El combo necesita al menos un componente.");
      return;
    }
    if (!nuevo.nombre.trim() || isNaN(precioCombo) || precioCombo <= 0) {
      setError("El combo necesita nombre y precio (> 0).");
      return;
    }
    setGuardando(true);
    try {
      await api.admin.createCombo({
        nombre: nuevo.nombre.trim(),
        descripcion: nuevo.descripcion.trim() || null,
        precio: precioCombo,
        etiqueta: nuevo.etiqueta.trim(),
        stock: parseInt(nuevo.stock || "0") || 0,
        items: componentes.map((c) => ({ producto_id: c.producto_id, cantidad: c.cantidad })),
      });
      setNuevo({ nombre: "", descripcion: "", precio: "", etiqueta: "", stock: "10" });
      setComponentes([]);
      setSelActual(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-marca">{error}</p>}

      {/* -------- Form nuevo combo -------- */}
      <form onSubmit={crearCombo} className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-bold">Nuevo combo</h2>
        <p className="text-xs text-gray-500">
          El precio es el que paga el cliente por el combo completo (suele ser menor que la suma de sus
          partes sueltas). Los componentes son descriptivos: el pedido viaja como UNA línea con el nombre
          del combo.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input className="border rounded px-2 py-1" placeholder="Nombre (ej: Combo Para 6)" required
            value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <input className="border rounded px-2 py-1" placeholder="Descripción" value={nuevo.descripcion}
            onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
          <input className="border rounded px-2 py-1" placeholder="Precio del combo $" type="number" step="1" required
            value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
          <input className="border rounded px-2 py-1" placeholder="Stock del combo" type="number" required
            value={nuevo.stock} onChange={(e) => setNuevo({ ...nuevo, stock: e.target.value })} />
          <input className="border rounded px-2 py-1 md:col-span-2" placeholder="Etiqueta (ej: 🍻 Día del Amigo)"
            value={nuevo.etiqueta} onChange={(e) => setNuevo({ ...nuevo, etiqueta: e.target.value })} />
        </div>

        {/* Selector de componentes (solo productos simples) */}
        <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
          <p className="text-sm font-semibold">Componentes (el cliente los verá en la card)</p>
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border rounded px-2 py-1" value={selActual}
              onChange={(e) => setSelActual(parseInt(e.target.value) || 0)}>
              <option value={0}>Producto…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} (${p.precio.toLocaleString("es-AR")})
                </option>
              ))}
            </select>
            <input
              type="number" min={1} className="border rounded px-2 py-1 w-20" value={cantActual}
              onChange={(e) => setCantActual(parseInt(e.target.value) || 1)}
              aria-label="Cantidad del componente"
            />
            <button type="button" onClick={agregarComponente} className="bg-gray-800 text-white px-3 py-1 rounded text-sm">
              + Componente
            </button>
            {totalSuelto > 0 && (
              <span className="text-sm text-gray-600 ml-2">
                Componentes sueltos: <strong>${totalSuelto.toLocaleString("es-AR")}</strong>
                {!isNaN(precioCombo) && precioCombo > 0 && (
                  <> → el cliente ahorra ${(totalSuelto - precioCombo).toLocaleString("es-AR")}</>
                )}
              </span>
            )}
          </div>

          <ul className="text-sm space-y-1">
            {componentes.map((f) => (
              <li key={f.key} className="flex items-center gap-2">
                <span className="flex-1">
                  {f.cantidad}× {f.nombre}
                  <span className="text-gray-400 ml-1">(${(f.cantidad * f.precio_unitario).toLocaleString("es-AR")})</span>
                </span>
                <input
                  type="number" min={1} className="border rounded px-1 py-0.5 w-16"
                  value={f.cantidad}
                  onChange={(e) =>
                    setComponentes(componentes.map((f2) =>
                      f2.key === f.key ? { ...f2, cantidad: parseInt(e.target.value) || 1 } : f2
                    ))
                  }
                  aria-label={`Cantidad de ${f.nombre}`}
                />
                <button
                  type="button"
                  onClick={() => setComponentes(componentes.filter((f2) => f2.key !== f.key))}
                  className="text-marca text-xs hover:underline"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>

        <button disabled={guardando} className="w-full bg-marca text-white py-2 rounded-lg font-semibold disabled:opacity-50">
          {guardando ? "Guardando…" : "Crear combo"}
        </button>
      </form>

      {/* -------- Cards de combos existentes -------- */}
      {cargando && <p>Cargando combos…</p>}
      {!cargando && combos.length === 0 && (
        <p className="text-gray-500">Todavía no hay combos creados.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {combos.map((c) => (
          <AdminComboCard key={c.id} combo={c} productos={productos} onRecargar={cargar} onError={setError} />
        ))}
      </div>
    </div>
  );
}

// ---------- Card de combo existente para el dueño ----------
function AdminComboCard({
  combo: c,
  productos,
  onRecargar,
  onError,
}: {
  combo: Producto;
  productos: Producto[]; // posibles componentes (simples)
  onRecargar: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  // Nombre/desc/precio/etiqueta/stock editables onBlur (patrón de Productos).
  async function editar(cambios: Partial<Producto>) {
    try {
      await api.admin.updateCombo(c.id, cambios);
      await onRecargar();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <div className={`border rounded-xl bg-white shadow-sm flex flex-col overflow-hidden ${c.activo ? "" : "opacity-60"}`}>
      <div className="relative">
        {c.imagen_url ? (
          <img src={c.imagen_url} alt={c.nombre} className="w-full h-32 object-cover" />
        ) : (
          <div className="w-full h-32 bg-marca/10 flex items-center justify-center text-4xl">🎉</div>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-2 py-1 rounded"
        >
          📷 Imagen
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await api.admin.uploadImagen(c.id, f);
              await onRecargar();
            } catch (err) {
              onError((err as Error).message);
            }
          }}
        />
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <input
          className="font-bold text-lg border-b focus:outline-none focus:border-marca"
          defaultValue={c.nombre}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.nombre) editar({ nombre: e.target.value.trim() }); }}
        />
        <input
          className="text-sm text-gray-600 border-b focus:outline-none focus:border-marca"
          defaultValue={c.descripcion ?? ""}
          placeholder="Descripción"
          onBlur={(e) => { if (e.target.value !== (c.descripcion ?? "")) editar({ descripcion: e.target.value || null }); }}
        />

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <label className="text-gray-500">Precio:</label>
            <input
              type="number" className="border rounded px-2 py-1 w-24"
              defaultValue={c.precio}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0 && v !== c.precio) editar({ precio: v });
              }}
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-gray-500">Stock:</label>
            <input
              type="number" className="border rounded px-2 py-1 w-20"
              defaultValue={c.stock}
              onBlur={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v) && v >= 0 && v !== c.stock) editar({ stock: v });
              }}
            />
          </div>
          <div className="col-span-2">
            <label className="text-gray-500 mr-1">Etiqueta:</label>
            <input
              className="border rounded px-2 py-1 w-full"
              defaultValue={c.etiqueta}
              placeholder='Ej: "🍻 Día del Amigo" (opcional)'
              onBlur={(e) => { if (e.target.value !== c.etiqueta) editar({ etiqueta: e.target.value }); }}
            />
          </div>
        </div>

        <EditorComponentes combo={c} productos={productos} onRecargar={onRecargar} onError={onError} />

        <div className="flex flex-wrap gap-2 mt-1 items-center">
          <button
            onClick={async () => {
              try { await api.admin.setComboActivo(c.id, !c.activo); await onRecargar(); }
              catch (e) { onError((e as Error).message); }
            }}
            className={`px-2 py-1 rounded text-xs font-semibold ${c.activo ? "bg-green-600 text-white" : "bg-gray-300"}`}
            title="Un combo apagado no se ve en la tienda (útil para sacarlo al día siguiente del festivo)"
          >
            {c.activo ? "✅ Activo" : "🚫 Apagado"}
          </button>
          <button
            onClick={async () => {
              if (!confirm(`¿Borrar el combo "${c.nombre}"? Los pedidos históricos se conservan.`)) return;
              try {
                await api.admin.deleteCombo(c.id);
                await onRecargar();
              } catch (e) { onError((e as Error).message); }
            }}
            className="px-2 py-1 rounded text-xs font-semibold bg-white border border-marca text-marca"
          >
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Editor inline de componentes de un combo existente ----------
function EditorComponentes({
  combo: c,
  productos,
  onRecargar,
  onError,
}: {
  combo: Producto;
  productos: Producto[];
  onRecargar: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [filas, setFilas] = useState<FilaComponente[]>([]);
  const [selActual, setSelActual] = useState(0);
  const [cantActual, setCantActual] = useState(1);

  function iniciar() {
    setFilas((c.combo_items ?? []).map((ci) => ({
      key: nuevoKey(), producto_id: ci.producto_id, cantidad: ci.cantidad,
      nombre: ci.nombre, precio_unitario: ci.precio_unitario,
    })));
    setSelActual(0);
    setCantActual(1);
    setEditando(true);
  }

  async function guardar() {
    if (filas.length === 0) {
      onError("El combo necesita al menos un componente.");
      return;
    }
    try {
      await api.admin.updateCombo(c.id, {
        items: filas.map((f) => ({ producto_id: f.producto_id, cantidad: f.cantidad })),
      });
      setEditando(false);
      await onRecargar();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  if (!editando) {
    return (
      <div className="text-sm">
        <p className="font-semibold mb-1">Componentes:</p>
        <ul className="text-gray-600">
          {(c.combo_items ?? []).map((ci) => (
            <li key={ci.producto_id}>• {ci.cantidad}× {ci.nombre}</li>
          ))}
          {(c.combo_items ?? []).length === 0 && <li className="text-marca">⚠️ Sin componentes</li>}
        </ul>
        <button onClick={iniciar} className="text-xs underline text-gray-700 hover:text-marca mt-1">
          Editar componentes
        </button>
      </div>
    );
  }

  // Modo edición: mismo selector que el form nuevo, y guarda con un solo PUT.
  return (
    <div className="border rounded-lg p-2 bg-gray-50 text-sm space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="border rounded px-2 py-1" value={selActual}
          onChange={(e) => setSelActual(parseInt(e.target.value) || 0)}>
          <option value={0}>Producto…</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre} (${p.precio.toLocaleString("es-AR")})</option>
          ))}
        </select>
        <input type="number" min={1} className="border rounded px-1 py-0.5 w-16" value={cantActual}
          onChange={(e) => setCantActual(parseInt(e.target.value) || 1)}
          aria-label="Cantidad del componente" />
        <button
          type="button"
          onClick={() => {
            const prod = productos.find((p) => p.id === selActual);
            if (!prod) return;
            if (filas.some((f) => f.producto_id === prod.id)) return; // ya está
            setFilas([...filas, { key: nuevoKey(), producto_id: prod.id, cantidad: cantActual, nombre: prod.nombre, precio_unitario: prod.precio }]);
            setSelActual(0);
            setCantActual(1);
          }}
          className="bg-gray-800 text-white px-2 py-1 rounded text-xs"
        >
          + Agregar
        </button>
      </div>
      <ul className="space-y-1">
        {filas.map((f) => (
          <li key={f.key} className="flex items-center gap-2">
            <span className="flex-1">{f.cantidad}× {f.nombre}</span>
            <input
              type="number" min={1} className="border rounded px-1 py-0.5 w-14"
              value={f.cantidad}
              onChange={(e) => setFilas(filas.map((f2) => (f2.key === f.key ? { ...f2, cantidad: parseInt(e.target.value) || 1 } : f2)))}
              aria-label={`Cantidad de ${f.nombre}`}
            />
            <button
              type="button"
              onClick={() => setFilas(filas.filter((f2) => f2.key !== f.key))}
              className="text-marca text-xs hover:underline"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button onClick={() => void guardar()} className="bg-marca text-white px-3 py-1 rounded text-xs font-semibold">
          Guardar componentes
        </button>
        <button onClick={() => setEditando(false)} className="text-xs underline text-gray-600">
          Cancelar
        </button>
      </div>
    </div>
  );
}