"""
Modelos de la base de datos (SQLAlchemy).

Cada clase = una tabla. Cada atributo = una columna. El ORM genera el CREATE
TABLE automáticamente con init_db.py. No escribimos SQL a mano: esto es más
legible y portable entre motores.

Tablas:
  Producto     lo que vende la pizzería (pizza, empanada, bebida, postre...).
  AdminUser    el dueño (login). No hay usuarios clientes.
  Pedido       un pedido enviado por WhatsApp. Arranca "pendiente".
  PedidoItem   cada línea de un pedido (cantidad x producto).

DECISIÓN CLAVE — snapshot en PedidoItem:
  En PedidoItem guardamos `nombre` y `precio_unitario` (copias del momento del
  pedido), NO solo el `producto_id`. ¿Por qué? Si el dueño cambia mañana el
  precio de la muzzarella o borra un producto, los pedidos HISTÓRICOS deben
  seguir mostrando lo que se cobró ese día. Si dependiéramos solo del FK, el
  análisis "lo más vendido" se rompería. Por eso `producto_id` además es
  nullable: si se borra el producto, el item sobrevive con su snapshot.
"""
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    Numeric,
    DateTime,
    ForeignKey,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Producto(Base):
    __tablename__ = "productos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(120), nullable=False)
    descripcion = Column(Text, nullable=True)
    precio = Column(Numeric(10, 2), nullable=False)
    precio_oferta = Column(Numeric(10, 2), nullable=True)  # null = no hay precio de oferta
    en_oferta = Column(Boolean, default=False, nullable=False)
    stock = Column(Integer, default=0, nullable=False)
    categoria = Column(String(40), nullable=False)  # pizza / empanada / bebida / postre
    imagen_url = Column(String(255), nullable=True)
    disponible = Column(Boolean, default=True, nullable=False)  # false si stock=0
    # "Alarma de stock": si es False (alarma ACTIVA, default), el producto se
    # OCULTA al cliente cuando stock=0. Si el dueño la pone en True (desactiva la
    # alarma), el producto se muestra marcado como "Sin stock" aunque no haya.
    mostrar_sin_stock = Column(Boolean, default=False, nullable=False)
    orden = Column(Integer, default=0, nullable=False)  # menor = aparece primero
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relación inversa: los items que referencian este producto.
    items = relationship("PedidoItem", back_populates="producto")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(60), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)  # bcrypt, nunca la password en claro
    nombre = Column(String(120), nullable=False)


class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    cliente_nombre = Column(String(120), nullable=False)
    telefono = Column(String(30), nullable=False)
    notas = Column(Text, nullable=True)
    total = Column(Numeric(10, 2), nullable=False)  # total de referencia (editable)
    estado = Column(String(20), default="pendiente", nullable=False)  # pendiente/confirmada/cancelada
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    confirmada_at = Column(DateTime, nullable=True)  # cuándo el dueño lo confirmó

    # Relación: un pedido tiene muchos items. cascade="all, delete-orphan" hace
    # que borrar el pedido borre sus items (no quedan items huérfanos).
    items = relationship(
        "PedidoItem",
        back_populates="pedido",
        cascade="all, delete-orphan",
    )


class PedidoItem(Base):
    __tablename__ = "pedido_items"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=True)  # null si se borró
    nombre = Column(String(120), nullable=False)          # SNAPSHOT del nombre
    cantidad = Column(Integer, nullable=False)
    precio_unitario = Column(Numeric(10, 2), nullable=False)  # SNAPSHOT del precio

    pedido = relationship("Pedido", back_populates="items")
    producto = relationship("Producto", back_populates="items")