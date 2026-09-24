// Pestaña Combos del dashboard: el dueño arma combos (ej: "6 empanadas + 2
// gaseosas") eligiendo productos del catálogo con cantidades y poniendo el
// precio del combo. La etiqueta libre le sirve para promos de días festivos
// ("🍻 Día del Amigo") y el toggle Activo para apagar la promo al otro día.
//
// STOCK: el combo NO tiene stock propio. Su disponibilidad es cuántos se
// pueden armar con el stock del local (el backend la calcula de los
// componentes y la devuelve en `stock`), y pedir un combo descuenta de
// cada componente automáticamente.
//
// A ELECCIÓN DEL CLIENTE: en vez de listar cada opción a mano, el dueño
// marca un botón y el grupo se arma SOLO con los productos de esa categoría
// (todas las empanadas, todas las bebidas...), pudiendo EXCLUIR a mano las
// que no entran (ej: la más cara). El grupo es "N lugares a repartir": en un
// combo de 6 empanadas el cliente mezcla gustos (3 carne + 3 queso); una
// bebida a elección (N=1) es elegir una sola.
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { gruposCombo, type Producto } from "@/types";
import AdminGaleriaImagenes from "@/components/AdminGaleriaImagenes";

// Fila del editor de componentes. Dos formas:
//  - FIJA: un producto concreto (producto_id + cantidad).
//  - GRUPO a elección: "N lugares a repartir entre las opciones" (grupo =
//    nombre de la categoría, opciones = ids de los productos incluidos).
//    Al GUARDAR se expande a una fila por opción (el formato que espera el
//    backend: mismas filas, mismo label de grupo, misma cantidad).
// `cantidad` admite "" MIENTRAS el dueño borra y retipea el número; el
// guardar valida que todas sean >= 1 (no se puede salvar con un campo vacío).
// Usamos `key` local porque dos filas podrían tener (por un instante) los
// mismos datos y React necesita claves únicas.
interface FilaComponente {
  key: number;
  cantidad: number | "";
  // fija:
  producto_id?: number;
  nombre?: string;
  precio_unitario?: number;
  // grupo a elección:
  grupo?: string;
  opciones?: number[];
}

// ¿Todas las filas tienen una cantidad válida (número >= 1)? Si no, devuelve
// la fila problemática para armar el mensaje de error.
function filaConCantidadInvalida(filas: FilaComponente[]): FilaComponente | undefined {
  return filas.find((f) => typeof f.cantidad !== "number" || f.cantidad < 1);
}

// Arma el payload de items para el backend, expandiendo los grupos.
// (Las cantidades ya fueron validadas por el llamador.)
function itemsPayload(filas: FilaComponente[]) {
  const items: { producto_id: number; cantidad: number; grupo?: string | null }[] = [];
  for (const f of filas) {
    if (typeof f.cantidad !== "number") continue; // defensivo: no debería llegar
    if (f.grupo) {
      for (const pid of f.opciones ?? []) {
        items.push({ producto_id: pid, cantidad: f.cantidad, grupo: f.grupo });
      }
    } else if (f.producto_id) {
      items.push({ producto_id: f.producto_id, cantidad: f.cantidad });
    }
  }
  return items;
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const nuevoKey = () => Date.now() - Math.random();

export default function Combos() {
  const [combos, setCombos] = useState<Producto[]>([]);       // TODOS (activos y apagados)
  const [productos, setProductos] = useState<Producto[]>([]); // componentes posibles (simples)
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -------- Form "nuevo combo" --------
  const [nuevo, setNuevo] = useState({ nombre: "", descripcion: "", precio: "", etiqueta: "" });
  const [componentes, setComponentes] = useState<FilaComponente[]>([]);
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

  // Precio de referencia: cuánto costarían los componentes sueltos. En los
  // grupos a elección no se sabe qué elegirá el cliente, así que usamos la
  // opción MÁS BARATA ("desde $X"). Cantidad vacía ("" mientras se borra)
  // aporta 0 hasta que se complete.
  const precioCombo = parseFloat(nuevo.precio);
  const totalSuelto = componentes.reduce((s, f) => {
    const cantidad = typeof f.cantidad === "number" ? f.cantidad : 0;
    if (f.grupo) {
      const precios = (f.opciones ?? [])
        .map((pid) => productos.find((p) => p.id === pid)?.precio ?? 0);
      return s + cantidad * (precios.length ? Math.min(...precios) : 0);
    }
    return s + cantidad * (f.precio_unitario ?? 0);
  }, 0);

  function agregarFijo(prod: Producto, cantidad: number) {
    setError(null);
    if (componentes.some((f) => f.producto_id === prod.id)) {
      setError(`"${prod.nombre}" ya está en el combo (podés cambiar la cantidad ahí).`);
      return;
    }
    setComponentes([
      ...componentes,
      { key: nuevoKey(), cantidad, producto_id: prod.id, nombre: prod.nombre, precio_unitario: prod.precio },
    ]);
  }

  // "Elección del cliente": crea el grupo con TODOS los productos de la
  // categoría del producto elegido; el dueño después excluye a mano los que
  // no entran (checkboxes de la fila).
  function agregarGrupo(prod: Producto, cantidad: number) {
    setError(null);
    const grupo = prod.categoria;
    if (componentes.some((f) => f.grupo === grupo)) {
      setError(`Ya pusiste "${capitalizar(grupo)}" a elección en este combo.`);
      return;
    }
    const opciones = productos.filter((p) => p.categoria === grupo).map((p) => p.id);
    if (opciones.length < 2) {
      setError(`La categoría "${capitalizar(grupo)}" necesita al menos 2 productos para ser a elección.`);
      return;
    }
    const key = nuevoKey();
    setComponentes([...componentes, { key, cantidad, grupo, opciones }]);
  }

  async function crearCombo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (componentes.length === 0) {
      setError("El combo necesita al menos un componente.");
      return;
    }
    const invalida = filaConCantidadInvalida(componentes);
    if (invalida) {
      setError(`Completá la cantidad de "${invalida.grupo ? `a elección (${capitalizar(invalida.grupo)})` : invalida.nombre}" (mínimo 1).`);
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
        items: itemsPayload(componentes),
      });
      setNuevo({ nombre: "", descripcion: "", precio: "", etiqueta: "" });
      setComponentes([]);
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
      <form onSubmit={crearCombo} className="bg-negro-panel border border-negro-borde rounded-lg p-4 space-y-3 text-gray-200">
        <h2 className="font-bold">Nuevo combo</h2>
        <p className="text-xs text-gray-400">
          El precio es el que paga el cliente por el combo completo (suele ser menor que la suma de sus
          partes sueltas). Sin stock propio: la disponibilidad del combo sale del stock de sus
          componentes en el local, y pedirlo los descuenta automáticamente.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" placeholder="Nombre (ej: Combo Para 6)" required
            value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" placeholder="Descripción" value={nuevo.descripcion}
            onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
          <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" placeholder="Precio del combo $" type="number" step="1" required
            value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
          <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-500 rounded px-2 py-1 md:col-span-2" placeholder="Etiqueta (ej: 🍻 Día del Amigo)"
            value={nuevo.etiqueta} onChange={(e) => setNuevo({ ...nuevo, etiqueta: e.target.value })} />
        </div>

        {/* Componentes del combo: selector (fijo / a elección) + lista de filas */}
        <div className="border border-negro-borde rounded-lg p-3 bg-negro space-y-2">
          <p className="text-sm font-semibold">Componentes (el cliente los verá en la card)</p>
          <SelectorAgregar
            productos={productos}
            onFijo={agregarFijo}
            onGrupo={agregarGrupo}
          />
          <ListaFilas
            filas={componentes}
            setFilas={setComponentes}
            productos={productos}
          />
          {totalSuelto > 0 && (
            <p className="text-sm text-gray-300">
              Componentes sueltos: <strong>desde ${totalSuelto.toLocaleString("es-AR")}</strong>
              {!isNaN(precioCombo) && precioCombo > 0 && (
                <> → el cliente ahorra ${(totalSuelto - precioCombo).toLocaleString("es-AR")}</>
              )}
            </p>
          )}
        </div>

        <button disabled={guardando} className="w-full bg-marca text-black py-2 rounded-lg font-semibold disabled:opacity-50">
          {guardando ? "Guardando…" : "Crear combo"}
        </button>
      </form>

      {/* -------- Cards de combos existentes -------- */}
      {cargando && <p>Cargando combos…</p>}
      {!cargando && combos.length === 0 && (
        <p className="text-gray-400">Todavía no hay combos creados.</p>
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
    <div className={`border border-negro-borde rounded-xl bg-negro-panel shadow-sm flex flex-col overflow-hidden text-gray-200 ${c.activo ? "" : "opacity-60"}`}>
      {/* Imagen principal arriba + galería completa (subir/borrar/marcar
          principal) igual que en la pestaña de productos. */}
      <div>
        {c.imagen_url ? (
          <img src={c.imagen_url} alt={c.nombre} className="w-full h-32 object-cover" />
        ) : (
          <div className="w-full h-32 bg-marca/10 flex items-center justify-center text-4xl">🎉</div>
        )}
      </div>

      <div className="p-3 pt-2">
        <AdminGaleriaImagenes producto={c} onRecargar={() => void onRecargar()} onError={onError} />
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <input
          className="font-bold text-lg border-b border-negro-borde bg-transparent text-gray-100 focus:outline-none focus:border-marca"
          defaultValue={c.nombre}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.nombre) editar({ nombre: e.target.value.trim() }); }}
        />
        <input
          className="text-sm text-gray-300 border-b border-negro-borde bg-transparent placeholder:text-gray-500 focus:outline-none focus:border-marca"
          defaultValue={c.descripcion ?? ""}
          placeholder="Descripción"
          onBlur={(e) => { if (e.target.value !== (c.descripcion ?? "")) editar({ descripcion: e.target.value || null }); }}
        />

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <label className="text-gray-400">Precio:</label>
            <input
              type="number" className="border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 w-24"
              defaultValue={c.precio}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0 && v !== c.precio) editar({ precio: v });
              }}
            />
          </div>
          {/* Disponibilidad CALCULADA por el backend (cuántos combos se pueden
              armar con el stock de los componentes): no es editable. */}
          <div className="flex items-center gap-1">
            <label className="text-gray-400">Se pueden armar:</label>
            <span className={`font-semibold ${c.stock > 0 ? "text-green-400" : "text-marca"}`}>
              {c.stock}
            </span>
          </div>
          <div className="col-span-2">
            <label className="text-gray-400 mr-1">Etiqueta:</label>
            <input
              className="border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 w-full"
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
            className={`px-2 py-1 rounded text-xs font-semibold ${c.activo ? "bg-green-600 text-white" : "bg-negro-borde text-gray-300"}`}
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
            className="px-2 py-1 rounded text-xs font-semibold border border-marca text-marca hover:bg-marca/10"
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

  function iniciar() {
    // Carga las filas del combo: las fijas tal cual, y las opciones de cada
    // grupo se vuelven a AGREGAR en una sola fila de grupo (así el dueño las
    // ve como las armó: "6× a elección — Empanada").
    const cargadas: FilaComponente[] = [];
    const por_grupo = new Map<string, FilaComponente>();
    for (const ci of c.combo_items ?? []) {
      if (ci.grupo) {
        let fila = por_grupo.get(ci.grupo);
        if (!fila) {
          fila = { key: nuevoKey(), cantidad: ci.cantidad, grupo: ci.grupo, opciones: [] };
          por_grupo.set(ci.grupo, fila);
          cargadas.push(fila);
        }
        fila.opciones!.push(ci.producto_id);
      } else {
        cargadas.push({
          key: nuevoKey(), cantidad: ci.cantidad, producto_id: ci.producto_id,
          nombre: ci.nombre, precio_unitario: ci.precio_unitario,
        });
      }
    }
    setFilas(cargadas);
    setEditando(true);
  }

  async function guardar() {
    if (filas.length === 0) {
      onError("El combo necesita al menos un componente.");
      return;
    }
    const invalida = filaConCantidadInvalida(filas);
    if (invalida) {
      onError(`Completá la cantidad de "${invalida.grupo ? `a elección (${capitalizar(invalida.grupo)})` : invalida.nombre}" (mínimo 1).`);
      return;
    }
    try {
      await api.admin.updateCombo(c.id, { items: itemsPayload(filas) });
      setEditando(false);
      await onRecargar();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  // Los grupos del combo para mostrarlos como alternativas (no como suma).
  const grupos = gruposCombo(c);

  if (!editando) {
    return (
      <div className="text-sm">
        <p className="font-semibold mb-1">Componentes:</p>
        <ul className="text-gray-300">
          {(c.combo_items ?? []).filter((ci) => !ci.grupo).map((ci) => (
            <li key={ci.producto_id}>• {ci.cantidad}× {ci.nombre}</li>
          ))}
          {grupos.map(({ grupo, opciones }) => (
            <li key={grupo}>
              • {opciones[0]?.cantidad}× a elección ({capitalizar(grupo)}):{" "}
              {opciones.map((o) => o.nombre).join(" / ")}
            </li>
          ))}
          {(c.combo_items ?? []).length === 0 && <li className="text-marca">⚠️ Sin componentes</li>}
        </ul>
        <button onClick={iniciar} className="text-xs underline text-gray-200 hover:text-marca mt-1">
          Editar componentes
        </button>
      </div>
    );
  }

  // Modo edición: mismo selector y lista que el form nuevo, guarda con un PUT.
  return (
    <div className="border border-negro-borde rounded-lg p-2 bg-negro text-sm space-y-2">
      <SelectorAgregar
        productos={productos}
        onFijo={(prod, cantidad) => {
          if (filas.some((f) => f.producto_id === prod.id)) return; // ya está
          setFilas([...filas, {
            key: nuevoKey(), cantidad, producto_id: prod.id,
            nombre: prod.nombre, precio_unitario: prod.precio,
          }]);
        }}
        onGrupo={(prod, cantidad) => {
          if (filas.some((f) => f.grupo === prod.categoria)) return; // ya está
          const opciones = productos.filter((p) => p.categoria === prod.categoria).map((p) => p.id);
          setFilas([...filas, { key: nuevoKey(), cantidad, grupo: prod.categoria, opciones }]);
        }}
      />
      <ListaFilas filas={filas} setFilas={setFilas} productos={productos} />
      <div className="flex gap-2">
        <button onClick={() => void guardar()} className="bg-marca text-black px-3 py-1 rounded text-xs font-semibold">
          Guardar componentes
        </button>
        <button onClick={() => setEditando(false)} className="text-xs underline text-gray-300">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ---------- Selector de componente (compartido por el form y el editor) ----------
// Elegís un producto y una cantidad, y decidís si es un componente FIJO
// (siempre entra) o si queda A ELECCIÓN del cliente: en ese caso el grupo se
// arma con todos los productos de la misma categoría del producto elegido.
function SelectorAgregar({
  productos,
  onFijo,
  onGrupo,
}: {
  productos: Producto[];
  onFijo: (prod: Producto, cantidad: number) => void;
  onGrupo: (prod: Producto, cantidad: number) => void;
}) {
  const [selActual, setSelActual] = useState(0);   // producto elegido (0 = nada)
  // String para que el input se pueda BORRAR del todo mientras se retipea;
  // la validación de "número >= 1" se hace al apretar un botón de agregar.
  const [cantActual, setCantActual] = useState("1");
  const [errorCant, setErrorCant] = useState(false);

  function agregar(como: "fijo" | "grupo") {
    setErrorCant(false);
    const prod = productos.find((p) => p.id === selActual);
    const cant = parseInt(cantActual);
    if (!prod) return;
    if (isNaN(cant) || cant < 1) {
      setErrorCant(true); // input vacío o en 0: se avisa, no se agrega nada
      return;
    }
    if (como === "fijo") onFijo(prod, cant);
    else onGrupo(prod, cant);
    setSelActual(0); // listo para elegir el próximo
    setCantActual("1");
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" value={selActual}
        onChange={(e) => setSelActual(parseInt(e.target.value) || 0)}>
        <option value={0}>Producto…</option>
        {productos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre} (${p.precio.toLocaleString("es-AR")})
          </option>
        ))}
      </select>
      <input
        type="number" min={1}
        className={`border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 w-20 ${errorCant ? "border-marca" : ""}`}
        value={cantActual}
        onChange={(e) => { setCantActual(e.target.value); setErrorCant(false); }}
        aria-label="Cantidad del componente"
        placeholder="Cant."
      />
      <button type="button" onClick={() => agregar("fijo")} className="bg-gray-700 text-white hover:bg-gray-600 px-3 py-1 rounded text-sm">
        + Componente
      </button>
      <button
        type="button"
        onClick={() => agregar("grupo")}
        className="bg-marca text-black px-3 py-1 rounded text-sm"
        title='El cliente elegirá entre TODOS los productos de la misma categoría que el producto seleccionado (después podés excluir los que no entren). Ej: 6 empanadas a elección de gustos.'
      >
        + 🧑 Elección del cliente
      </button>
      {errorCant && (
        <span className="text-marca text-xs">Poné una cantidad (mínimo 1)</span>
      )}
    </div>
  );
}

// ---------- Lista de filas de componentes (compartida por el form y el editor) ----------
function ListaFilas({
  filas,
  setFilas,
  productos,
}: {
  filas: FilaComponente[];
  setFilas: (f: FilaComponente[]) => void;
  productos: Producto[];
}) {
  // Filas de grupo con el panel de opciones abierto (checkboxes).
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set());

  function toggleAbierta(key: number) {
    setAbiertas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(key)) nuevo.delete(key);
      else nuevo.add(key);
      return nuevo;
    });
  }

  function editar(key: number, cambio: (f: FilaComponente) => FilaComponente) {
    setFilas(filas.map((f) => (f.key === key ? cambio(f) : f)));
  }

  // El input se puede borrar del todo mientras se retipea: "" queda en el
  // estado y el guardar valida que sea un número >= 1 antes de mandar nada.
  const leerCantidad = (v: string): number | "" => {
    if (v === "") return "";
    const n = parseInt(v);
    return isNaN(n) ? "" : n;
  };

  return (
    <ul className="text-sm space-y-1">
      {filas.map((f) =>
        f.grupo ? (
          <li key={f.key} className="border border-negro-borde rounded p-2 bg-negro-panel">
            <div className="flex items-center gap-2">
              <span className="flex-1">
                {f.cantidad || 0}× a elección — <strong>{capitalizar(f.grupo)}</strong>{" "}
                <span className="text-xs text-gray-400">
                  ({f.opciones?.length ?? 0} opciones)
                </span>
              </span>
              <input
                type="number" min={1}
                className={`border-negro-borde bg-negro text-gray-100 rounded px-1 py-0.5 w-14 ${typeof f.cantidad !== "number" || f.cantidad < 1 ? "border-marca" : ""}`}
                value={f.cantidad}
                onChange={(e) => editar(f.key, (x) => ({ ...x, cantidad: leerCantidad(e.target.value) }))}
                aria-label={`Lugares a repartir de ${f.grupo}`}
                placeholder="Cant."
              />
              <button
                type="button"
                onClick={() => toggleAbierta(f.key)}
                className="text-xs underline text-gray-200 hover:text-marca"
              >
                {abiertas.has(f.key) ? "Ocultar opciones" : "Ver opciones"}
              </button>
              <button
                type="button"
                onClick={() => setFilas(filas.filter((f2) => f2.key !== f.key))}
                className="text-marca text-xs hover:underline"
              >
                Quitar
              </button>
            </div>

            {/* Panel de opciones: qué productos de la categoría ve el cliente.
                Todas entran por default; el dueño desmarca las que no. */}
            {abiertas.has(f.key) && (
              <div className="mt-2 border-t pt-2">
                <p className="text-xs text-gray-400 mb-1">
                  El cliente elige entre los marcados (suma {f.cantidad || 0} en total):
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {productos
                    .filter((p) => p.categoria === f.grupo)
                    .map((p) => {
                      const incluido = f.opciones?.includes(p.id) ?? false;
                      return (
                        <label key={p.id} className="text-xs flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={incluido}
                            onChange={() =>
                              editar(f.key, (x) => ({
                                ...x,
                                opciones: incluido
                                  ? (x.opciones ?? []).filter((id) => id !== p.id)
                                  : [...(x.opciones ?? []), p.id],
                              }))
                            }
                          />
                          {p.nombre}
                        </label>
                      );
                    })}
                </div>
                {(f.opciones?.length ?? 0) < 2 && (
                  <p className="text-marca text-xs mt-1">
                    ⚠️ Dejanos al menos 2 opciones marcadas (si no, no hay elección).
                  </p>
                )}
              </div>
            )}
          </li>
        ) : (
          <li key={f.key} className="flex items-center gap-2">
            <span className="flex-1">
              {f.cantidad || 0}× {f.nombre}
              <span className="text-gray-400 ml-1">
                (${((typeof f.cantidad === "number" ? f.cantidad : 0) * (f.precio_unitario ?? 0)).toLocaleString("es-AR")})
              </span>
            </span>
            <input
              type="number" min={1}
              className={`border-negro-borde bg-negro text-gray-100 rounded px-1 py-0.5 w-16 ${typeof f.cantidad !== "number" || f.cantidad < 1 ? "border-marca" : ""}`}
              value={f.cantidad}
              onChange={(e) => editar(f.key, (x) => ({ ...x, cantidad: leerCantidad(e.target.value) }))}
              aria-label={`Cantidad de ${f.nombre}`}
              placeholder="Cant."
            />
            <button
              type="button"
              onClick={() => setFilas(filas.filter((f2) => f2.key !== f.key))}
              className="text-marca text-xs hover:underline"
            >
              Quitar
            </button>
          </li>
        )
      )}
    </ul>
  );
}