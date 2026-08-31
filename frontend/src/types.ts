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
  stock: number;
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
export interface ComboItem {
  producto_id: number;
  cantidad: number;
  nombre: string;
  precio_unitario: number;
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

// ----- Pedidos -----
export interface PedidoItemInput {
  // producto_id null/ausente = ítem "Otro" que agrega el dueño a mano
  // (nombre + precio manual, vive solo como snapshot en ese pedido).
  producto_id?: number | null;
  cantidad: number;
  nombre?: string | null;          // solo para "Otro"
  precio_unitario?: number | null; // solo para "Otro"
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

// ----- Auth -----
export interface Token {
  access_token: string;
  token_type: string;
}