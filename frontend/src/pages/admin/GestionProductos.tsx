import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Producto } from "@/types";

export default function GestionProductos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario "nuevo producto".
  const [nuevo, setNuevo] = useState({
    nombre: "",
    descripcion: "",
    precio: "",
    stock: "",
    categoria: "pizza",
    precio_oferta: "",
  });
  const [nuevaImagen, setNuevaImagen] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);

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

  useEffect(() => {
    cargar();
  }, []);

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
      setNuevo({ nombre: "", descripcion: "", precio: "", stock: "", categoria: "pizza", precio_oferta: "" });
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
      <form onSubmit={crear} className="bg-white border rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
        <h2 className="col-span-full font-bold">Nuevo producto</h2>
        <input className="border rounded px-2 py-1" placeholder="Nombre" required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <input className="border rounded px-2 py-1" placeholder="Descripción" value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
        <select className="border rounded px-2 py-1" value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}>
          <option value="pizza">Pizza</option>
          <option value="empanada">Empanada</option>
          <option value="bebida">Bebida</option>
          <option value="postre">Postre</option>
        </select>
        <input className="border rounded px-2 py-1" type="number" placeholder="Precio $" required value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
        <input className="border rounded px-2 py-1" type="number" placeholder="Precio oferta $" value={nuevo.precio_oferta} onChange={(e) => setNuevo({ ...nuevo, precio_oferta: e.target.value })} />
        <input className="border rounded px-2 py-1" type="number" placeholder="Stock" value={nuevo.stock} onChange={(e) => setNuevo({ ...nuevo, stock: e.target.value })} />
        {/* Imagen: input de archivo. Se sube después de crear el producto. */}
        <div className="col-span-full">
          <label className="text-sm text-gray-600 mr-2">Imagen:</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setNuevaImagen(e.target.files?.[0] ?? null)}
          />
          {nuevaImagen && <span className="text-xs text-gray-500 ml-2">→ {nuevaImagen.name}</span>}
        </div>
        <button disabled={guardando} className="col-span-full bg-marca text-white py-2 rounded font-semibold disabled:opacity-50">
          {guardando ? "Guardando…" : "Agregar producto"}
        </button>
      </form>

      {/* Cards de productos (vista del dueño) */}
      {cargando && <p>Cargando productos…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {productos.map((p) => (
          <AdminProductoCard
            key={p.id}
            producto={p}
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
  onEditar,
  onToggleOferta,
  onToggleAlarma,
  onBorrar,
  onSubirImagen,
}: {
  producto: Producto;
  onEditar: (id: number, cambios: Partial<Producto>) => void;
  onToggleOferta: (p: Producto) => void;
  onToggleAlarma: (p: Producto) => void;
  onBorrar: (p: Producto) => void;
  onSubirImagen: (id: number, file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const oculto = p.stock <= 0 && !p.mostrar_sin_stock; // no lo ve el cliente

  return (
    <div className={`border rounded-xl bg-white shadow-sm flex flex-col overflow-hidden ${oculto ? "opacity-60" : ""}`}>
      {/* Imagen + botón cambiar */}
      <div className="relative">
        {p.imagen_url ? (
          <img src={p.imagen_url} alt={p.nombre} className="w-full h-32 object-cover" />
        ) : (
          <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-4xl">🍕</div>
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
          className="font-bold text-lg border-b focus:outline-none focus:border-marca"
          defaultValue={p.nombre}
          onBlur={(e) => { if (e.target.value !== p.nombre) onEditar(p.id, { nombre: e.target.value }); }}
        />
        <input
          className="text-sm text-gray-600 border-b focus:outline-none focus:border-marca"
          defaultValue={p.descripcion ?? ""}
          placeholder="Descripción"
          onBlur={(e) => { if (e.target.value !== (p.descripcion ?? "")) onEditar(p.id, { descripcion: e.target.value }); }}
        />

        {/* Precio + stock (el dueño SÍ ve el stock) */}
        <div className="flex gap-2 items-center text-sm">
          <label className="text-gray-500">Precio:</label>
          <input
            type="number"
            className="border rounded px-2 py-1 w-24"
            defaultValue={p.precio}
            onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== p.precio) onEditar(p.id, { precio: v }); }}
          />
        </div>
        <div className="flex gap-2 items-center text-sm">
          <label className="text-gray-500">Stock:</label>
          <input
            type="number"
            className="border rounded px-2 py-1 w-24"
            defaultValue={p.stock}
            onBlur={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== p.stock) onEditar(p.id, { stock: v, disponible: v > 0 }); }}
          />
          {oculto && <span className="text-xs text-gray-500">(oculto al cliente)</span>}
        </div>

        {/* Botones: oferta / alarma / borrar */}
        <div className="flex flex-wrap gap-2 mt-1">
          <button
            onClick={() => onToggleOferta(p)}
            className={`px-2 py-1 rounded text-xs font-semibold ${p.en_oferta ? "bg-marca text-white" : "bg-gray-200"}`}
          >
            {p.en_oferta ? `Oferta $${p.precio_oferta}` : "No en oferta"}
          </button>
          <button
            onClick={() => onToggleAlarma(p)}
            className={`px-2 py-1 rounded text-xs font-semibold ${p.mostrar_sin_stock ? "bg-gray-700 text-white" : "bg-gray-200"}`}
            title="Si está activa (gris), el producto se oculta al cliente cuando stock=0. Al desactivarla (oscuro), se muestra marcado 'Sin stock'."
          >
            {p.mostrar_sin_stock ? "Alarma OFF" : "Alarma ON"}
          </button>
          <button onClick={() => onBorrar(p)} className="px-2 py-1 rounded text-xs font-semibold bg-white border border-marca text-marca">
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}