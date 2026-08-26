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


class OfertaUpdate(BaseModel):
    """Para marcar/desmarcar oferta + precio de oferta."""
    en_oferta: bool
    precio_oferta: Optional[Decimal] = None  # si en_oferta=False, se ignora/limpia


class ProductoOut(ProductoBase):
    """Lo que se devuelve al cliente. Suma el id y fechas."""
    id: int
    created_at: datetime
    updated_at: datetime

    # Permite leer datos desde un objeto SQLAlchemy (orm_mode). Sin esto,
    # Pydantic no sabría convertir un modelo ORM en respuesta JSON.
    model_config = ConfigDict(from_attributes=True)


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


# ---------- Pedidos ----------
class PedidoItemCreate(BaseModel):
    """Una línea del pedido que envía el cliente."""
    producto_id: int
    cantidad: int = Field(gt=0)  # debe ser > 0


class PedidoItemOut(BaseModel):
    id: int
    producto_id: Optional[int]
    nombre: str
    cantidad: int
    precio_unitario: Decimal
    model_config = ConfigDict(from_attributes=True)


class PedidoCreate(BaseModel):
    """El cliente envía esto al finalizar el carrito."""
    cliente_nombre: str
    telefono: str
    notas: Optional[str] = None
    items: list[PedidoItemCreate]


class PedidoUpdate(BaseModel):
    """El dueño edita el pedido para que coincida con lo conversado por WhatsApp."""
    cliente_nombre: Optional[str] = None
    telefono: Optional[str] = None
    notas: Optional[str] = None
    # Para editar items reemplazamos la lista completa (simple y predecible).
    items: Optional[list[PedidoItemCreate]] = None


class PedidoOut(BaseModel):
    """Pedido completo, con sus items, para el dashboard del dueño."""
    id: int
    cliente_nombre: str
    telefono: str
    notas: Optional[str]
    total: Decimal
    estado: str
    created_at: datetime
    confirmada_at: Optional[datetime]
    items: list[PedidoItemOut]
    model_config = ConfigDict(from_attributes=True)


# ---------- Análisis ----------
class ProductoVendido(BaseModel):
    """Resultado del endpoint de "lo más vendido"."""
    nombre: str
    cantidad_total: int
    ingreso_total: Decimal