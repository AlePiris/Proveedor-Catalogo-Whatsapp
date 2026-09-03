import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Categoria, Producto } from "@/types";
import { esCombo } from "@/types";

export default function GestionProductos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario "nuevo producto".
  const [nuevo, setNuevo] = useState({
    nombre: "",
    descripcion: "",
    precio: "",
    stock: "",
    categoria: "barritas",
    precio_oferta: "",
  });
  const [nuevaImagen, setNuevaImagen] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Formulario "nueva categoría" (se carga aparte de los productos: es lo
  // que llena el select de categoría de arriba y el orden de la tienda).
  const [nuevaCat, setNuevaCat] = useState("");

  async function cargar() {
    setCargando(true);
    try {
      // El admin ve TODOS los productos (incluye los ocultos por sin-stock).
      setProductos(await api.admin.getProductos());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function cargarCategorias() {
    try {
      setCategorias(await api.admin.getCategorias());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    cargar();
    cargarCategorias();
  }, []);

  // Si la categoría por defecto del form no existe (primera vez, o el dueño
  // la borró), sincronizamos con la primera disponible.
  useEffect(() => {
    if (categorias.length > 0 && !categorias.some((c) => c.nombre === nuevo.categoria)) {
      setNuevo((n) => ({ ...n, categoria: categorias[0].nombre }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorias]);

  async function editar(id: number, cambios: Partial<Producto>) {
    try {
      await api.admin.updateProducto(id, cambios);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleOferta(p: Producto) {
    try {
      if (!p.en_oferta) {
        const val = prompt(`Precio de oferta para "${p.nombre}" (normal: $${p.precio}):`);
        if (val == null) return;
        const num = parseFloat(val);
        if (isNaN(num)) return;
        await api.admin.setOferta(p.id, true, num);
      } else {
        await api.admin.setOferta(p.id, false, null);
      }
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleAlarma(p: Producto) {
    // mostrar_sin_stock = True  =>  desactiva la alarma (lo muestra marcado si stock=0)
    await editar(p.id, { mostrar_sin_stock: !p.mostrar_sin_stock });
  }

  async function borrar(p: Producto) {
    if (!confirm(`¿Borrar "${p.nombre}"? Los pedidos históricos se conservan.`)) return;
    try {
      await api.admin.deleteProducto(p.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function crearCategoria(e: React.FormEvent) {
    e.preventDefault();
    const nombre = nuevaCat.trim();
    if (!nombre) return;
    try {
      // La nueva categoría va al final (orden = el mayor + 1).
      const orden = categorias.length > 0 ? Math.max(...categorias.map((c) => c.orden)) + 1 : 0;
      await api.admin.createCategoria(nombre, orden);
      setNuevaCat("");
      await cargarCategorias();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renombrarCategoria(c: Categoria) {
    const nombre = prompt(`Nuevo nombre para "${c.nombre}":`, c.nombre);
    if (nombre == null) return;
    const limpio = nombre.trim();
    if (!limpio || limpio === c.nombre) return;
    try {
      // El backend renombra EN CASCADA los productos que usan esta categoría.
      await api.admin.updateCategoria(c.id, { nombre: limpio });
      await cargarCategorias();
      await cargar(); // las cards muestran la categoría actualizada
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function borrarCategoria(c: Categoria) {
    if (!confirm(`¿Borrar la categoría "${c.nombre}"? Solo se puede si no tiene productos.`)) return;
    try {
      await api.admin.deleteCategoria(c.id);
      await cargarCategorias();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const creado = await api.admin.createProducto({
        nombre: nuevo.nombre,
        descripcion: nuevo.descripcion || null,
        precio: parseFloat(nuevo.precio),
        stock: parseInt(nuevo.stock || "0"),
        categoria: nuevo.categoria,
        precio_oferta: nuevo.precio_oferta ? parseFloat(nuevo.precio_oferta) : null,
        en_oferta: nuevo.precio_oferta ? true : false,
      });
      // Si eligió una imagen, la sube al producto recién creado.
      if (nuevaImagen) {
        await api.admin.uploadImagen(creado.id, nuevaImagen);
      }
      // Al crear, conservamos la categoría seleccionada: el dueño suele
      // cargar varios productos de la misma seguidos.
      setNuevo((n) => ({ ...n, nombre: "", descripcion: "", precio: "", stock: "", precio_oferta: "" }));
      setNuevaImagen(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-marca">{error}</p>}

      {/* Formulario nuevo producto */}
      <form onSubmit={crear} className="bg-negro-panel border border-negro-borde rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-gray-200">
        <h2 className="col-span-full font-bold">Nuevo producto</h2>
        <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" placeholder="Nombre" required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" placeholder="Descripción" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
        <select className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}>
          {categorias.map((c) => (
            <option key={c.id} value={c.nombre}>{c.nombre}</option>
          ))}
        </select>
        <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" type="number" placeholder="Precio $" required value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
        <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" type="number" placeholder="Precio oferta $" value={nuevo.precio_oferta} onChange={(e) => setNuevo({ ...nuevo, precio_oferta: e.target.value })} />
        <input className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-400 rounded px-2 py-1" type="number" placeholder="Stock" value={nuevo.stock} onChange={(e) => setNuevo({ ...nuevo, stock: e.target.value })} />
        {/* Imagen: input de archivo. Se sube después de crear el producto. */}
        <div className="col-span-full">
          <label className="text-sm text-gray-300 mr-2">Imagen:</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setNuevaImagen(e.target.files?.[0] ?? null)}
          />
          {nuevaImagen && <span className="text-xs text-gray-400 ml-2">→ {nuevaImagen.name}</span>}
        </div>
        <button disabled={guardando} className="col-span-full bg-marca text-black py-2 rounded font-semibold disabled:opacity-50">
          {guardando ? "Guardando…" : "Agregar producto"}
        </button>
      </form>

      {/* Gestión de categorías: son las SECCIONES de la tienda (una por
          categoría, en este orden). Renombrar actualiza los productos que la
          usan; borrar solo se puede si no tiene productos. "combo" es un
          nombre reservado del backend (los combos viven en su propia tab). */}
      <div className="bg-negro-panel border border-negro-borde rounded-lg p-4">
        <h2 className="font-bold mb-2 text-gray-100">Categorías del menú</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {categorias.map((c) => {
            const cantidad = productos.filter((p) => p.categoria === c.nombre).length;
            return (
              <span key={c.id} className="inline-flex items-center gap-1 bg-gray-800 text-gray-200 rounded-full pl-3 pr-1 py-1 text-sm">
                {c.nombre}
                <span className="text-xs text-gray-400">({cantidad})</span>
                <button
                  onClick={() => renombrarCategoria(c)}
                  className="w-5 h-5 rounded-full hover:bg-gray-700"
                  title="Renombrar"
                >
                  ✎
                </button>
                <button
                  onClick={() => borrarCategoria(c)}
                  className="w-5 h-5 rounded-full hover:bg-gray-700"
                  title="Borrar (solo si no tiene productos)"
                >
                  ✕
                </button>
              </span>
            );
          })}
          {categorias.length === 0 && (
            <p className="text-sm text-gray-400">No hay categorías. Agregá una acá abajo.</p>
          )}
        </div>
        <form onSubmit={crearCategoria} className="flex gap-2">
          <input
            className="border-negro-borde bg-negro text-gray-100 placeholder:text-gray-500 rounded px-2 py-1 flex-1 max-w-xs"
            placeholder="Nueva categoría (ej: Barritas clásicas)"
            value={nuevaCat}
            onChange={(e) => setNuevaCat(e.target.value)}
          />
          <button className="bg-marca text-black px-3 py-1 rounded text-sm font-semibold">
            Agregar categoría
          </button>
        </form>
      </div>

      {/* Cards de productos (vista del dueño) */}
      {cargando && <p className="text-gray-300">Cargando productos…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {productos.map((p) => (
          <AdminProductoCard
            key={p.id}
            producto={p}
            categorias={categorias}
            onEditar={editar}
            onToggleOferta={toggleOferta}
            onToggleAlarma={toggleAlarma}
            onBorrar={borrar}
            onSubirImagen={async (id, file) => {
              try {
                await api.admin.uploadImagen(id, file);
                await cargar();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- Card de producto para el dueño (editable) ----------
function AdminProductoCard({
  producto: p,
  categorias,
  onEditar,
  onToggleOferta,
  onToggleAlarma,
  onBorrar,
  onSubirImagen,
}: {
  producto: Producto;
  categorias: Categoria[];
  onEditar: (id: number, cambios: Partial<Producto>) => void;
  onToggleOferta: (p: Producto) => void;
  onToggleAlarma: (p: Producto) => void;
  onBorrar: (p: Producto) => void;
  onSubirImagen: (id: number, file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const oculto = p.stock <= 0 && !p.mostrar_sin_stock; // no lo ve el cliente
  // Opciones del select: las categorías de la tabla. Si el producto está en
  // una que no existe en la tabla (dato viejo), la agregamos al listado para
  // que el select no muestre vacío.
  const opciones = categorias.some((c) => c.nombre === p.categoria)
    ? categorias
    : [...categorias, { id: -1, nombre: p.categoria, orden: 0 }];

  return (
    <div className={`border border-negro-borde rounded-xl bg-negro-panel shadow-sm flex flex-col overflow-hidden text-gray-200 ${oculto ? "opacity-60" : ""}`}>
      {/* Imagen + botón cambiar */}
      <div className="relative">
        {p.imagen_url ? (
          <img src={p.imagen_url} alt={p.nombre} className="w-full aspect-square object-cover" />
        ) : (
          <div className="w-full aspect-square bg-negro flex items-center justify-center text-4xl">🍫</div>
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
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onSubirImagen(p.id, f);
          }}
        />
      </div>

      <div className="p-3 flex flex-col gap-2">
        {/* Nombre editable */}
        <input
          className="font-bold text-lg border-b border-negro-borde bg-transparent text-gray-100 focus:outline-none focus:border-marca"
          defaultValue={p.nombre}
          onBlur={(e) => { if (e.target.value !== p.nombre) onEditar(p.id, { nombre: e.target.value }); }}
        />
        <input
          className="text-sm text-gray-300 border-b border-negro-borde bg-transparent placeholder:text-gray-500 focus:outline-none focus:border-marca"
          defaultValue={p.descripcion ?? ""}
          placeholder="Descripción"
          onBlur={(e) => { if (e.target.value !== (p.descripcion ?? "")) onEditar(p.id, { descripcion: e.target.value }); }}
        />

        {/* Precio + stock (el dueño SÍ ve el stock) */}
        <div className="flex gap-2 items-center text-sm">
          <label className="text-gray-400">Categoría:</label>
          <select
            className="border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 flex-1"
            value={p.categoria}
            onChange={(e) => { if (e.target.value !== p.categoria) onEditar(p.id, { categoria: e.target.value }); }}
          >
            {opciones.map((c) => (
              <option key={c.id} value={c.nombre}>{c.nombre}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center text-sm">
          <label className="text-gray-400">Precio:</label>
          <input
            type="number"
            className="border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 w-24"
            defaultValue={p.precio}
            onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== p.precio) onEditar(p.id, { precio: v }); }}
          />
        </div>
        <div className="flex gap-2 items-center text-sm">
          <label className="text-gray-400">Stock:</label>
          {/* Combos: sin stock propio. El backend devuelve en `stock` cuántos
              se pueden armar con los componentes del local (no editable). */}
          {esCombo(p) ? (
            <span className={`font-semibold ${p.stock > 0 ? "text-green-400" : "text-marca"}`}>
              {p.stock} (según componentes)
            </span>
          ) : (
            <input
              type="number"
              className="border-negro-borde bg-negro text-gray-100 rounded px-2 py-1 w-24"
              defaultValue={p.stock}
              onBlur={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== p.stock) onEditar(p.id, { stock: v, disponible: v > 0 }); }}
            />
          )}
          {oculto && <span className="text-xs text-gray-400">(oculto al cliente)</span>}
        </div>

        {/* Botones: oferta / alarma / borrar */}
        <div className="flex flex-wrap gap-2 mt-1">
          <button
            onClick={() => onToggleOferta(p)}
            className={`px-2 py-1 rounded text-xs font-semibold ${p.en_oferta ? "bg-marca text-black" : "bg-negro-borde text-gray-300"}`}
          >
            {p.en_oferta ? `Oferta $${p.precio_oferta}` : "No en oferta"}
          </button>
          <button
            onClick={() => onToggleAlarma(p)}
            className={`px-2 py-1 rounded text-xs font-semibold ${p.mostrar_sin_stock ? "bg-gray-700 text-white" : "bg-negro-borde text-gray-300"}`}
            title="Si está activa (gris), el producto se oculta al cliente cuando stock=0. Al desactivarla (oscuro), se muestra marcado 'Sin stock'."
          >
            {p.mostrar_sin_stock ? "Alarma OFF" : "Alarma ON"}
          </button>
          <button onClick={() => onBorrar(p)} className="px-2 py-1 rounded text-xs font-semibold border border-marca text-marca hover:bg-marca/10">
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}