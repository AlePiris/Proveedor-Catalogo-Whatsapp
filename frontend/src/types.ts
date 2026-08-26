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
  created_at: string;
  updated_at: string;
}

// Precio efectivo: si está en oferta y tiene precio_oferta, uso ese; si no, el normal.
export function precioEfectivo(p: Producto): number {
  return p.en_oferta && p.precio_oferta != null ? p.precio_oferta : p.precio;
}

// ----- Pedidos -----
export interface PedidoItemInput {
  producto_id: number;
  cantidad: number;
}

export interface PedidoCreate {
  cliente_nombre: string;
  telefono: string;
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
  notas: string | null;
  total: number;
  estado: EstadoPedido;
  created_at: string;
  confirmada_at: string | null;
  items: PedidoItemOut[];
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