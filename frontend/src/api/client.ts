// Cliente HTTP central. Todas las llamadas a la API pasan por acá.

// DOBLE BASE URL:
//  - En desarrollo: VITE_API_URL no está definida -> usamos "/api" (relativa).
//    El proxy de Vite (ver vite.config.ts) la redirige al backend local/Docker.
//  - En producción (Vercel): VITE_API_URL = URL del backend en Vercel.
// Así el mismo código funciona en ambos entornos sin tocar nada.
const BASE = import.meta.env.VITE_API_URL || "/api";

// Guardamos el token del admin en localStorage. El navegador lo conserva entre
// recargas. Si no hay token, no se manda (los endpoints públicos igual funcionan).
const TOKEN_KEY = "pizzeria_admin_token";
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Wrapper de fetch. Maneja JSON, el header Authorization cuando hace falta y
 * los errores HTTP (lanza un Error con el mensaje que manda el backend).
 *
 * @param path   ruta relativa (ej. "/productos")
 * @param auth   si true, manda el token (para endpoints de admin)
 */
async function request<T>(path: string, opts: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers as Record<string, string>) };
  if (opts.body && typeof opts.body === "string") headers["Content-Type"] = "application/json";
  if (auth) {
    const t = getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  // 204 (sin contenido): devolvemos null como T.
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.detail) || `Error ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

// ===================== Endpoints públicos =====================
import type {
  Producto,
  PedidoCreate,
  PedidoOut,
  Token,
  LocalConfig,
  Categoria,
  VentaPorDia,
} from "@/types";

export const api = {
  // Productos (tienda)
  getProductos: () => request<Producto[]>("/productos"),
  getProducto: (id: number) => request<Producto>(`/productos/${id}`),

  // Categorías (tienda: para agrupar los productos en secciones)
  getCategorias: () => request<Categoria[]>("/categorias"),

  // Pedidos (lo llama el cliente al finalizar el carrito)
  createPedido: (p: PedidoCreate) =>
    request<PedidoOut>("/pedidos", { method: "POST", body: JSON.stringify(p) }),

  // Config del local (público: la leen footer, /contacto y el carrito)
  getConfig: () => request<LocalConfig>("/config"),

  // Auth
  login: (username: string, password: string) =>
    request<Token>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  // Recuperación de contraseña (públicos; spec deploy §4c). responder SIEMPRE
  // genérico: el backend nunca confirma si el usuario existe.
  recuperarPassword: (username: string) =>
    request<{ detail: string }>("/auth/recuperar", { method: "POST", body: JSON.stringify({ username }) }),
  restablecerPassword: (token: string, password_nueva: string) =>
    request<{ detail: string }>(
      "/auth/restablecer",
      { method: "POST", body: JSON.stringify({ token, password_nueva }) }
    ),

  // ===== Admin (auth=true) =====
  admin: {
    // Productos
    getProductos: () => request<Producto[]>("/productos/admin", {}, true), // TODOS (incluye ocultos)
    createProducto: (p: Partial<Producto>) =>
      request<Producto>("/productos", { method: "POST", body: JSON.stringify(p) }, true),
    updateProducto: (id: number, p: Partial<Producto>) =>
      request<Producto>(`/productos/${id}`, { method: "PUT", body: JSON.stringify(p) }, true),
    setOferta: (id: number, en_oferta: boolean, precio_oferta: number | null) =>
      request<Producto>(
        `/productos/${id}/oferta`,
        { method: "PATCH", body: JSON.stringify({ en_oferta, precio_oferta }) },
        true
      ),
    deleteProducto: (id: number) =>
      request<null>(`/productos/${id}`, { method: "DELETE" }, true),

    // Combos (categoria="combo"): precio propio + componentes.
    // SIN stock: la disponibilidad del combo sale del stock de sus componentes.
    // `grupo` en un componente = fila de un grupo a elección (mismo label =
    // opciones entre las que el cliente elige UNA; undefined = fijo).
    createCombo: (c: {
      nombre: string;
      descripcion?: string | null;
      precio: number;
      etiqueta?: string;
      items: { producto_id: number; cantidad: number; grupo?: string | null }[];
    }) =>
      request<Producto>("/combos", { method: "POST", body: JSON.stringify(c) }, true),
    updateCombo: (
      id: number,
      c: Partial<Producto> & { items?: { producto_id: number; cantidad: number; grupo?: string | null }[] }
    ) =>
      request<Producto>(`/combos/${id}`, { method: "PUT", body: JSON.stringify(c) }, true),
    setComboActivo: (id: number, activo: boolean) =>
      request<Producto>(`/combos/${id}/activo`, { method: "PATCH", body: JSON.stringify({ activo }) }, true),
    deleteCombo: (id: number) =>
      request<null>(`/combos/${id}`, { method: "DELETE" }, true),
    uploadImagen: async (id: number, file: File) => {
      // Subida de archivo: se manda como multipart/form-data (no JSON).
      // El backend la AGREGA a la galería (ya no pisa la anterior); solo la
      // primera subida pasa a ser la principal.
      const fd = new FormData();
      fd.append("archivo", file);
      const headers: Record<string, string> = { Accept: "application/json" };
      const t = getToken();
      if (t) headers["Authorization"] = `Bearer ${t}`;
      const res = await fetch(`${BASE}/productos/${id}/imagen`, { method: "POST", body: fd, headers });
      if (!res.ok) throw new Error("No se pudo subir la imagen");
      return (await res.json()) as Producto;
    },
    deleteImagen: (productoId: number, imagenId: number) =>
      request<null>(`/productos/${productoId}/imagen/${imagenId}`, { method: "DELETE" }, true),
    setImagenPrincipal: (productoId: number, imagenId: number) =>
      request<Producto>(
        `/productos/${productoId}/imagen/${imagenId}/principal`,
        { method: "PATCH" },
        true
      ),

    // Pedidos
    getPedidos: (estado?: string) =>
      request<PedidoOut[]>(`/admin/pedidos${estado ? `?estado=${estado}` : ""}`, {}, true),
    getPedido: (id: number) =>
      request<PedidoOut>(`/admin/pedidos/${id}`, {}, true),
    updatePedido: (id: number, p: Partial<PedidoCreate>) =>
      request<PedidoOut>(`/admin/pedidos/${id}`, { method: "PUT", body: JSON.stringify(p) }, true),
    confirmarPedido: (id: number) =>
      request<PedidoOut>(`/admin/pedidos/${id}/confirmar`, { method: "PATCH" }, true),
    cancelarPedido: (id: number) =>
      request<PedidoOut>(`/admin/pedidos/${id}/cancelar`, { method: "PATCH" }, true),

    // Análisis
    getMasVendidos: (limite = 10) =>
      request<{ nombre: string; cantidad_total: number; ingreso_total: number }[]>(
        `/admin/analisis/mas-vendidos?limite=${limite}`,
        {},
        true
      ),
    getVentasPorDia: (dias = 7) =>
      request<VentaPorDia[]>(`/admin/analisis/ventas-por-dia?dias=${dias}`, {}, true),

    // Config del local (Ajustes)
    updateConfig: (c: Partial<LocalConfig>) =>
      request<LocalConfig>("/config", { method: "PUT", body: JSON.stringify(c) }, true),
    // Logo del local (Ajustes): sube o quita la imagen. La imagen ES el
    // interruptor: sin subida no hay logo, y con subida reemplaza la anterior.
    uploadLogo: async (file: File) => {
      const fd = new FormData();
      fd.append("archivo", file);
      const headers: Record<string, string> = { Accept: "application/json" };
      const t = getToken();
      if (t) headers["Authorization"] = `Bearer ${t}`;
      const res = await fetch(`${BASE}/config/logo`, { method: "POST", body: fd, headers });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.detail) || "No se pudo subir el logo");
      }
      return (await res.json()) as LocalConfig;
    },
    borrarLogo: () =>
      request<LocalConfig>("/config/logo", { method: "DELETE" }, true),

    // Cambio de contraseña del dueño logueado (spec deploy §4b). El backend
    // revalida todo; acá el form también valida para no golpear la API al vacío.
    cambiarPassword: (password_actual: string, password_nueva: string) =>
      request<{ ok: boolean }>(
        "/auth/password",
        { method: "PUT", body: JSON.stringify({ password_actual, password_nueva }) },
        true
      ),

    // Categorías (secciones del menú)
    getCategorias: () => request<Categoria[]>("/categorias", {}, true),
    createCategoria: (nombre: string, orden = 0) =>
      request<Categoria>("/categorias", { method: "POST", body: JSON.stringify({ nombre, orden }) }, true),
    updateCategoria: (id: number, cambios: { nombre?: string; orden?: number }) =>
      request<Categoria>(`/categorias/${id}`, { method: "PUT", body: JSON.stringify(cambios) }, true),
    deleteCategoria: (id: number) =>
      request<null>(`/categorias/${id}`, { method: "DELETE" }, true),
  },
};