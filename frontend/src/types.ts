// Tipos compartidos que espejan los schemas del backend (app/schemas.py).
// Mantenerlos acá hace que el contrato entre frontend y backend sea explícito:
// si el backend cambia un campo, TS te avisa al compilar.

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: number;          // Decimal -> number en JS
  precio_oferta: number | null;
  en_oferta: boolean;
  stock: number;            // en combos: cuántos se pueden armar (calculado del stock de los componentes)
  categoria: string;
  imagen_url: string | null;
  disponible: boolean;
  mostrar_sin_stock: boolean; // alarma: si True, se muestra al cliente aunque stock=0
  orden: number;
  etiqueta: string;       // badge opcional (combos/especiales, ej: "🍻 Día del Amigo")
  activo: boolean;        // interruptor manual de visibilidad (combos)
  created_at: string;
  updated_at: string;
  // Componentes SI el producto es un combo (categoria="combo"); [] en el resto.
  combo_items?: ComboItem[];
}

// Componente de un combo: describe el contenido (nombre/precio actuales del
// producto). Lo que se cobra es el precio del propio combo.
//
// grupo: si está, todas las filas con el mismo label son OPCIONES a elección
// ("Bebida": Coca, Agua...): el cliente elige UNA al agregar el combo.
// undefined/vacío = componente fijo (siempre entra al combo).
export interface ComboItem {
  producto_id: number;
  cantidad: number;
  nombre: string;
  precio_unitario: number;
  stock: number;             // stock actual del componente (para los selectores)
  grupo?: string | null;
}

// La elección del cliente dentro de un grupo del combo: el grupo es "N
// unidades a repartir entre las opciones", así que cada elección dice
// CUÁNTAS unidades de ese producto (la suma del grupo debe dar exacto N).
export interface Eleccion {
  grupo: string;
  producto_id: number;
  cantidad: number;
}

// Precio efectivo: si está en oferta y tiene precio_oferta, uso ese; si no, el normal.
export function precioEfectivo(p: Producto): number {
  return p.en_oferta && p.precio_oferta != null ? p.precio_oferta : p.precio;
}

// ¿Es combo? El dueño no elige "combo" manualmente: la categoría la fija el backend.
export function esCombo(p: Producto): boolean {
  return p.categoria === "combo";
}

// Texto descriptivo del combo para la card: "6× Empanada Carne + 2× Coca 1.5L".
export function descripcionCombo(p: Producto): string {
  return (p.combo_items ?? [])
    .map((ci) => `${ci.cantidad}× ${ci.nombre}`)
    .join(" + ");
}

// Los grupos a elección del combo, en el orden en que aparecen:
// [{grupo: "Bebida", opciones: [Coca, Agua, Fanta]}]. Los componentes fijos
// no entran. Si el combo no tiene grupos, devuelve [].
export function gruposCombo(p: Producto): { grupo: string; opciones: ComboItem[] }[] {
  const por_grupo = new Map<string, ComboItem[]>();
  for (const ci of p.combo_items ?? []) {
    if (!ci.grupo) continue;
    const opciones = por_grupo.get(ci.grupo) ?? [];
    opciones.push(ci);
    por_grupo.set(ci.grupo, opciones);
  }
  return [...por_grupo.entries()].map(([grupo, opciones]) => ({ grupo, opciones }));
}

// Texto legible de las elecciones guardadas en el carrito, agrupadas:
// "Empanada: 3× Carne + 3× Queso; Bebida: Coca 1.5L". Busca los nombres en
// los combo_items del producto; si el dueño editó el combo y la opción ya no
// está, la muestra como "(removida)". null si no hubo elecciones.
export function textoElecciones(p: Producto, elecciones?: Eleccion[] | null): string | null {
  if (!elecciones || elecciones.length === 0) return null;
  const por_grupo = new Map<string, string[]>();
  for (const e of elecciones) {
    const ci = (p.combo_items ?? []).find((c) => c.producto_id === e.producto_id);
    const nombre = ci?.nombre ?? "(removida)";
    const partes = por_grupo.get(e.grupo) ?? [];
    partes.push(e.cantidad !== 1 ? `${e.cantidad}× ${nombre}` : nombre);
    por_grupo.set(e.grupo, partes);
  }
  const partes = [...por_grupo.entries()].map(([grupo, nombres]) => `${grupo}: ${nombres.join(" + ")}`);
  return partes.join("; ") || null;
}

// ----- Categorías (secciones del menú, editables por el dueño) -----
export interface Categoria {
  id: number;
  nombre: string;   // matchea Producto.categoria (match por nombre)
  orden: number;    // menor = la sección aparece antes en la tienda
}

// ----- Pedidos -----
export interface PedidoItemInput {
  // producto_id null/ausente = ítem "Otro" que agrega el dueño a mano
  // (nombre + precio manual, vive solo como snapshot en ese pedido).
  producto_id?: number | null;
  cantidad: number;
  nombre?: string | null;          // solo para "Otro"
  precio_unitario?: number | null; // solo para "Otro"
  // Solo para combos con grupos a elección: UNA elección por grupo
  // (el backend valida contra las opciones que definió el dueño).
  elecciones?: Eleccion[] | null;
}

export type TipoEntrega = "takeaway" | "delivery";
export type TipoPago = "efectivo" | "mercado_pago";

export interface PedidoCreate {
  cliente_nombre: string;
  telefono: string;
  tipo_entrega: TipoEntrega;
  direccion?: string | null; // solo para delivery
  metodo_pago: TipoPago;
  notas?: string | null;
  items: PedidoItemInput[];
}

export interface PedidoItemOut {
  id: number;
  producto_id: number | null;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  // Elecciones legibles del combo ("Bebida: Coca 1.5L"); null si no hubo.
  detalle?: string | null;
  // Elecciones estructuradas: para que el editor reenvíe intactas al guardar.
  elecciones?: { grupo: string; producto_id: number; nombre: string; cantidad: number }[] | null;
}

export type EstadoPedido = "pendiente" | "confirmada" | "cancelada";

export interface PedidoOut {
  id: number;
  cliente_nombre: string;
  telefono: string;
  tipo_entrega: TipoEntrega;
  direccion: string | null;
  metodo_pago: TipoPago;
  notas: string | null;
  total: number;
  estado: EstadoPedido;
  created_at: string;
  confirmada_at: string | null;
  items: PedidoItemOut[];
}

// ----- Config del local (editada por el dueño en Ajustes) -----
export interface LocalConfig {
  nombre: string;
  direccion: string;
  telefono: string;
  whatsapp: string;   // formato internacional sin + (ej. 5491100000000)
  radio_delivery_km: number; // 0 = delivery deshabilitado
  horarios: string;
  descripcion: string;
}

// ----- Análisis -----
export interface ProductoVendido {
  nombre: string;
  cantidad_total: number;
  ingreso_total: number;
}

// Un renglón por día (los días sin ventas vienen con ceros).
export interface VentaPorDia {
  fecha: string; // "YYYY-MM-DD" (día en que el cliente HIZO el pedido)
  pedidos: number;
  unidades: number;
  ingreso_total: number;
}

// ----- Auth -----
export interface Token {
  access_token: string;
  token_type: string;
}