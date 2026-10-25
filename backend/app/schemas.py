"""
Esquemas de Pydantic (contrato de la API).

Diferencia con models.py:
  - models.py (SQLAlchemy) = CÓMO se guardan los datos en Postgres.
  - schemas.py (Pydantic)  = QUÉ entra y sale por HTTP. Valida y genera /docs.

Por qué separarlos:
  1. La DB y la API cambian por motivos distintos (una columna vs un campo del
     JSON). Si las mezclaras, un cambio en la DB rompería el contrato HTTP.
  2. Seguridad: queremos distintos "recortes" del mismo dato. El cliente ve
     ProductoOut (sin campos internos). El admin manda ProductoCreate. El
     password_hash NUNCA sale en ningún schema de salida.

Convención de nombres:
  *Create  → lo que se envía para crear.
  *Update  → lo que se envía para editar (campos opcionales).
  *Out     → lo que se devuelve (respuesta).
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- Análisis ----------
class ProductoVendido(BaseModel):
    """Resultado del endpoint de "lo más vendido"."""
    nombre: str
    cantidad_total: int
    ingreso_total: Decimal


class VentaPorDia(BaseModel):
    """Resultado del endpoint "ventas por día": un renglón por día.

    fecha: "YYYY-MM-DD" (agrupamos por día de created_at del pedido).
    pedidos / unidades / ingreso: agregados de los pedidos CONFIRMADOS
    de ese día. Los días sin ventas van incluidos con ceros (así el
    gráfico del dueño muestra los huecos, no los oculta)."""
    fecha: str
    pedidos: int
    unidades: int
    ingreso_total: Decimal


# ---------- Productos ----------
class ProductoBase(BaseModel):
    """Campos compartidos entre crear/editar/ver."""
    nombre: str
    descripcion: Optional[str] = None
    precio: Decimal
    precio_oferta: Optional[Decimal] = None
    en_oferta: bool = False
    stock: int = 0
    categoria: str
    imagen_url: Optional[str] = None
    disponible: bool = True
    mostrar_sin_stock: bool = False  # alarma de stock (False = oculto al cliente si stock=0)
    orden: int = 0
    etiqueta: str = ""
    activo: bool = True


class ProductoCreate(ProductoBase):
    """Para crear. Hereda todo de ProductoBase (todos los campos requeridos)."""
    pass


class ProductoUpdate(BaseModel):
    """Para editar: todos los campos OPCIONALES (solo se actualizan los que vienen).
    Por eso no heredamos de ProductoBase (que los exigiría)."""
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    precio: Optional[Decimal] = None
    precio_oferta: Optional[Decimal] = None
    en_oferta: Optional[bool] = None
    stock: Optional[int] = None
    categoria: Optional[str] = None
    imagen_url: Optional[str] = None
    disponible: Optional[bool] = None
    mostrar_sin_stock: Optional[bool] = None
    orden: Optional[int] = None
    etiqueta: Optional[str] = None
    activo: Optional[bool] = None


class OfertaUpdate(BaseModel):
    """Para marcar/desmarcar oferta + precio de oferta."""
    en_oferta: bool
    precio_oferta: Optional[Decimal] = None  # si en_oferta=False, se ignora/limpia


class ProductoImagenOut(BaseModel):
    """Una foto del producto (la galería del detalle usa todas; la principal
    además vive denormalizada en producto.imagen_url)."""
    id: int
    url: str
    orden: int
    model_config = ConfigDict(from_attributes=True)


class ProductoOut(ProductoBase):
    """Lo que se devuelve al cliente. Suma el id y fechas."""
    id: int
    created_at: datetime
    updated_at: datetime
    # Componentes SI el producto es un combo (siempre los trae, vacío en el resto).
    combo_items: list["ComboItemOut"] = []
    # TODAS las fotos del producto (galería del detalle). El admin las gestiona;
    # si está vacío y hay imagen_url, el frontend usa esa como fallback.
    imagenes: list[ProductoImagenOut] = []

    # Permite leer datos desde un objeto SQLAlchemy (orm_mode). Sin esto,
    # Pydantic no sabría convertir un modelo ORM en respuesta JSON.
    model_config = ConfigDict(from_attributes=True)


# ---------- Categorías ----------
class CategoriaCreate(BaseModel):
    """Para crear una categoría. El nombre debe matchear (por convención) el
    valor que se guarda en Producto.categoria."""
    nombre: str = Field(min_length=1, max_length=40)
    orden: int = 0


class CategoriaUpdate(BaseModel):
    """Para editar: todo opcional (solo lo que viene). Si viene `nombre`, el
    router renombra en cascada los productos con el nombre anterior."""
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=40)
    orden: Optional[int] = None


class CategoriaOut(BaseModel):
    """Lo que ve el cliente (para armar las secciones) y el admin (para el
    select del form de productos)."""
    id: int
    nombre: str
    orden: int
    model_config = ConfigDict(from_attributes=True)


# ---------- Combos ----------
class ComboItemIn(BaseModel):
    """Componente de un combo que manda el dueño (producto + cantidad).

    grupo: si está, TODAS las filas con el mismo label son OPCIONES a
    elección ("Bebida": Coca, Agua...). El cliente elige UNA de ellas al
    pedir el combo. NULL/vacío = componente fijo (siempre entra)."""
    producto_id: int
    cantidad: int = Field(gt=0)
    grupo: Optional[str] = None


class ComboItemOut(BaseModel):
    """Componente para mostrarlo en la web: con nombre, precio y stock ACTUAL
    del producto (el precio "real"/de venta del combo es el del propio combo).
    El stock lo usa el selector de los grupos a elección para preseleccionar
    una opción que tenga unidades."""
    producto_id: int
    cantidad: int
    nombre: str
    precio_unitario: Decimal
    stock: int
    grupo: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class ComboCreate(BaseModel):
    """Crea un combo (categoria='combo' fija): precio propio + componentes.
    SIN stock: la disponibilidad del combo se calcula desde el stock de sus
    componentes (cuántos combos se pueden armar con lo que hay en el local)."""
    nombre: str
    descripcion: Optional[str] = None
    precio: Decimal
    etiqueta: str = ""          # badge opcional (ej: "🍻 Día del Amigo")
    imagen_url: Optional[str] = None
    items: list[ComboItemIn]    # mínimo 1, valida el router


class ComboUpdate(BaseModel):
    """Edita el combo. `items` reemplaza la lista completa (predecible)."""
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    precio: Optional[Decimal] = None
    etiqueta: Optional[str] = None
    items: Optional[list[ComboItemIn]] = None


class ComboActivoUpdate(BaseModel):
    """PATCH de visibilidad manual del combo (activar/desactivar)."""
    activo: bool


# ---------- Auth ----------
class Token(BaseModel):
    """Respuesta del login: el token que el frontend guarda y manda en cada
    request admin (header Authorization: Bearer <access_token>)."""
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    """Body del login. Alternativa al form-data (más simple para el frontend)."""
    username: str
    password: str


class PasswordChange(BaseModel):
    """Cambio de contraseña del dueño LOGUEADO (spec deploy §4b). La nueva no
    lleva validación de longitud en el schema: la fija el endpoint (400 si <8)
    para que el mensaje de error diga exactamente eso."""
    password_actual: str
    password_nueva: str


class RecuperarRequest(BaseModel):
    """Body del "olvidé mi contraseña" (spec deploy §4c). Solo username: el
    EMAIL va a direcciones fijas de env vars, nunca lo pide el formulario."""
    username: str


class RestablecerRequest(BaseModel):
    """Body del restablecimiento con token del email."""
    token: str
    password_nueva: str


# ---------- Pedidos ----------
class EleccionOut(BaseModel):
    """La elección guardada en el pedido (para que el editor del dueño pueda
    reenviarla intacta al reemplazar los items)."""
    grupo: str
    producto_id: int
    nombre: str
    cantidad: int


class EleccionCreate(BaseModel):
    """La elección del cliente dentro de un GRUPO del combo: cuántas unidades
    de ese producto ocupan el lugar del grupo. El grupo es "N unidades a
    repartir entre las opciones": 6 empanadas -> 3 Carne + 3 Queso; una bebida
    (N=1) -> 1 Coca. La SUMA de las cantidades del grupo debe dar exactamente
    N (lo valida el router)."""
    grupo: str
    producto_id: int
    cantidad: int = Field(gt=0)


class PedidoItemCreate(BaseModel):
    """
    Una línea del pedido. Dos formas válidas (excluyentes, valida el router):
      - Con producto_id: se toma del catálogo, el SNAPSHOT de nombre/precio lo
        hace el BACKEND (no se confía en el cliente).
      - Sin producto_id: ítem a mano "Otro" (el dueño lo agrega en el editor
        cuando el cliente pidió algo fuera del menú, ej. "bacon extra").
        Requiere nombre + precio_unitario. Vive solo como snapshot de ESTE
        pedido (producto_id queda NULL, igual que un producto borrado).

    Si el producto es un combo con grupos a elección, `elecciones` DEBE traer
    una elección por grupo (lo valida el router).
    """
    producto_id: Optional[int] = None
    nombre: Optional[str] = None      # solo para el ítem "Otro"
    precio_unitario: Optional[Decimal] = None  # "Otro" (precio a mano) o precio NEGOCIADO del dueño sobre un item del catálogo (solo admin; el público lo ignora)
    cantidad: int = Field(gt=0)  # debe ser > 0
    elecciones: Optional[list[EleccionCreate]] = None  # solo para combos con grupos


class PedidoItemOut(BaseModel):
    id: int
    producto_id: Optional[int]
    nombre: str
    cantidad: int
    precio_unitario: Decimal
    # Elecciones legibles del combo ("Bebida: Coca 1.5L"); None si no hubo.
    # Lo arma la propiedad PedidoItem.detalle (models.py).
    detalle: Optional[str] = None
    # Elecciones ESTRUCTURADAS (grupo/producto_id/nombre): para el editor.
    # OJO con el alias: el PedidoItem ORM tiene una COLUMNA "elecciones" (el
    # JSON crudo en texto) y una PROPIEDAD "elecciones_data" (la lista parseada).
    # Sin validation_alias, from_attributes leería la columna y Pydantic
    # reventaría intentando validar un string como lista.
    elecciones: Optional[list[EleccionOut]] = Field(default=None, validation_alias="elecciones_data")
    model_config = ConfigDict(from_attributes=True)


class PedidoCreate(BaseModel):
    """El cliente envía esto al finalizar el carrito."""
    cliente_nombre: str
    # Opcional: en el modelo B2B el contacto es por WhatsApp (el número ya lo
    # tenemos ahí). Se guarda vacío si el cliente no lo informa.
    telefono: str = ""
    # "takeaway" (retira) o "delivery" (envío al local del cliente, el modelo
    # actual). El router exige dirección si es delivery.
    tipo_entrega: str = "takeaway"
    # Solo para delivery (el router exige dirección si el cliente lo pide a casa).
    direccion: Optional[str] = None
    # "efectivo" o "mercado_pago" (el router valida que sea uno de esos dos).
    metodo_pago: str = "efectivo"
    notas: Optional[str] = None
    items: list[PedidoItemCreate]


class PedidoUpdate(BaseModel):
    """El dueño edita el pedido para que coincida con lo conversado por WhatsApp."""
    cliente_nombre: Optional[str] = None
    telefono: Optional[str] = None
    notas: Optional[str] = None
    metodo_pago: Optional[str] = None  # por si el pago coordinado por WA fue otro
    # Para editar items reemplazamos la lista completa (simple y predecible).
    items: Optional[list[PedidoItemCreate]] = None


class PedidoOut(BaseModel):
    """Pedido completo, con sus items, para el dashboard del dueño."""
    id: int
    cliente_nombre: str
    telefono: str
    tipo_entrega: str
    direccion: Optional[str]
    metodo_pago: str
    notas: Optional[str]
    total: Decimal
    estado: str
    created_at: datetime
    confirmada_at: Optional[datetime]
    items: list[PedidoItemOut]
    model_config = ConfigDict(from_attributes=True)


# ---------- Config del local ----------
class ConfigOut(BaseModel):
    """Datos del local que ve cualquiera (footer, página /contacto, carrito).
    Los mismos datos edita el dueño en Ajustes (PUT con token)."""
    nombre: str
    direccion: str
    telefono: str
    whatsapp: str
    radio_delivery_km: int
    horarios: str
    descripcion: str
    # Logo del local: ruta relativa "/uploads/..." o "" si no hay. Sin imagen
    # no hay logo (la imagen ES el interruptor; no existe toggle aparte).
    logo_url: str
    model_config = ConfigDict(from_attributes=True)


class ConfigUpdate(BaseModel):
    """Para editar. Todos los campos opcionales: solo se actualizan los que
    vienen en el body (mismo patrón que ProductoUpdate)."""
    nombre: Optional[str] = None
    direccion: Optional[str] = None
    telefono: Optional[str] = None
    whatsapp: Optional[str] = None
    radio_delivery_km: Optional[int] = Field(default=None, ge=0)  # no hay radio negativo
    horarios: Optional[str] = None
    descripcion: Optional[str] = None
    # "" = sin logo. El flujo normal del frontend es el POST/DELETE de
    # /api/config/logo (sube o borra el archivo); este campo queda como vía
    # directa para limpiarlo o setearlo a mano.
    logo_url: Optional[str] = None