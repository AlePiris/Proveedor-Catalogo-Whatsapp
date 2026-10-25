"""
Modelos de la base de datos (SQLAlchemy).

Cada clase = una tabla. Cada atributo = una columna. El ORM genera el CREATE
TABLE automáticamente con init_db.py. No escribimos SQL a mano: esto es más
legible y portable entre motores.

Tablas:
  Producto     lo que vende la pizzería (pizza, empanada, bebida, postre...).
               También los COMBOS (categoria="combo"): precio propio y
               componentes en combo_items.
  ComboItem    componente de un combo (producto + cantidad). Solo describe el
               combo: al pedir, el combo entra como UNA línea (snapshot).
  AdminUser    el dueño (login). No hay usuarios clientes.
  Pedido       un pedido enviado por WhatsApp. Arranca "pendiente".
  PedidoItem   cada línea de un pedido (cantidad x producto).
  LocalConfig  datos del local (dirección, contacto, radio de delivery...
               horarios), UNA sola fila editable por el dueño desde el
               dashboard (pestaña Ajustes).

DECISIÓN CLAVE — snapshot en PedidoItem:
  En PedidoItem guardamos `nombre` y `precio_unitario` (copias del momento del
  pedido), NO solo el `producto_id`. ¿Por qué? Si el dueño cambia mañana el
  precio de la muzzarella o borra un producto, los pedidos HISTÓRICOS deben
  seguir mostrando lo que se cobró ese día. Si dependiéramos solo del FK, el
  análisis "lo más vendido" se rompería. Por eso `producto_id` además es
  nullable: si se borra el producto, el item sobrevive con su snapshot.
"""
import json
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
    # Etiqueta libre para destacar el item (ej: "🍻 Día del Amigo", "Súper
    # combo"). La usan los combos/especiales; en productos simples queda "".
    etiqueta = Column(String(60), nullable=False, default="")
    # Interruptor manual de visibilidad (lo usan los combos para apagarlos el
    # día siguiente al festivo sin borrarlos). Producto simple siempre True.
    activo = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relación inversa: los items que referencian este producto.
    items = relationship("PedidoItem", back_populates="producto")
    # Si este producto ES un combo: sus componentes. foreign_keys necesario
    # porque combo_items tiene DOS FKs contra productos (combo_id y producto_id).
    combo_items = relationship(
        "ComboItem",
        back_populates="combo",
        foreign_keys="ComboItem.combo_id",
        cascade="all, delete-orphan",  # borrar el combo borra sus componentes
    )
    # Si este producto es COMPONENTE de combos: acá figura (solo lectura).
    combos_que_lo_incluyen = relationship(
        "ComboItem", back_populates="producto", foreign_keys="ComboItem.producto_id"
    )
    # TODAS las fotos del producto (la galería de la página de detalle). La
    # foto PRINCIPAL sigue viva además en la columna imagen_url.
    imagenes = relationship(
        "ProductoImagen",
        back_populates="producto",
        cascade="all, delete-orphan",  # borrar el producto borra sus fotos
        order_by="ProductoImagen.orden",  # menor = primero en la galería
    )


class ProductoImagen(Base):
    """
    Una de las (posibles varias) fotos de un producto.

    DECISIÓN — imagen_url sigue siendo la PRINCIPAL (denormalizada):
    la tabla guarda TODAS las fotos (galería de la página de detalle),
    pero producto.imagen_url conserva la foto PRINCIPAL: la primera subida
    o la que el dueño marque. Las cards, el carrusel y el carrito persistido
    en el navegador ya leen imagen_url; derivarla de la primera fila
    obligaría a tocar todo sin sumar nada. La tabla es la fuente de verdad
    de la GALERÍA; imagen_url, de la TAPA.
    """

    __tablename__ = "producto_imagenes"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    # Ruta relativa que sirve StaticFiles (ej: "/uploads/12_abc123.jpg").
    url = Column(String(255), nullable=False)
    orden = Column(Integer, default=0, nullable=False)  # menor = primero en la galería
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    producto = relationship("Producto", back_populates="imagenes")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(60), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)  # bcrypt, nunca la password en claro
    nombre = Column(String(120), nullable=False)


class PasswordReset(Base):
    """
    Solicitud de recuperación de contraseña ("olvidé mi contraseña", spec
    deploy §4c). Una fila por token pedido; el token REAL viaja solo por
    email — en la DB queda SOLO su hash SHA-256 (si alguien ve la DB, no
    puede usar esos tokens). Un solo uso y expira a los 30 minutos.
    """

    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admin_users.id"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False, index=True)
    expira_en = Column(DateTime, nullable=False)
    usado = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    cliente_nombre = Column(String(120), nullable=False)
    telefono = Column(String(30), nullable=False)
    # Tipo de entrega: "takeaway" (retira en el local) o "delivery". El costo
    # y el alcance real los confirma la pizzería por WhatsApp: acá solo queda
    # REGISTRADO qué eligió el cliente y a dónde llevarlo.
    tipo_entrega = Column(String(20), default="takeaway", nullable=False)
    direccion = Column(String(200), nullable=True)  # solo para delivery
    # Método de pago que el cliente eligió: "efectivo" o "mercado_pago". La
    # pizzería lo cobra físicamente (no hay cobro online); esto solo informa.
    metodo_pago = Column(String(30), default="efectivo", nullable=False)
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
    # NULL en dos casos: (1) el producto se borró del catálogo, (2) es un ítem
    # "Otro" que el dueño agregó a mano en el editor (ej. "bacon extra").
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=True)
    nombre = Column(String(120), nullable=False)          # SNAPSHOT del nombre
    cantidad = Column(Integer, nullable=False)
    precio_unitario = Column(Numeric(10, 2), nullable=False)  # SNAPSHOT del precio

    pedido = relationship("Pedido", back_populates="items")
    producto = relationship("Producto", back_populates="items")

    # Elecciones del cliente en los grupos del combo ("Bebida: Coca", "6
    # empanadas: 3 Carne + 3 Queso"): JSON con [{"grupo": ..., "producto_id":
    # ..., "nombre": ..., "cantidad": ...}]. NULL si el item no es un combo
    # con grupos. Guardar QUÉ y CUÁNTO eligió sirve para tres cosas:
    #   1) el dueño sabe qué entregar (dashboard y WhatsApp lo muestran),
    #   2) el stock se descuenta del producto ELEGIDO,
    #   3) si el pedido se cancela, se reintegra exactamente eso.
    elecciones = Column(Text, nullable=True)

    @property
    def detalle(self) -> str | None:
        """Las elecciones en texto legible, agrupadas: "Empanada: 3× Carne + 3×
        Queso; Bebida: Coca 1.5L". None si el item no tuvo elecciones. Lo
        expone el schema PedidoItemOut."""
        if not self.elecciones:
            return None
        try:
            pares = json.loads(self.elecciones)
        except (TypeError, ValueError):
            return None  # JSON corrupto: mejor no romper el pedido histórico
        por_grupo: dict[str, list[str]] = {}
        orden: list[str] = []
        for e in pares:
            grupo, nombre = e.get("grupo"), e.get("nombre")
            if not grupo or not nombre:
                continue
            cantidad = e.get("cantidad", 1)
            if grupo not in por_grupo:
                por_grupo[grupo] = []
                orden.append(grupo)
            por_grupo[grupo].append(f"{cantidad}× {nombre}" if cantidad and cantidad != 1 else nombre)
        partes = [f"{g}: {' + '.join(por_grupo[g])}" for g in orden]
        return "; ".join(partes) or None

    @property
    def elecciones_data(self) -> list[dict] | None:
        """Las elecciones como lista (para el OUT). Sirve al EDITOR de pedidos:
        al reemplazar los items, el dueño reenvía las elecciones del combo
        intactas (si no, el backend las exigiría de nuevo)."""
        if not self.elecciones:
            return None
        try:
            return json.loads(self.elecciones)
        except (TypeError, ValueError):
            return None


class ComboItem(Base):
    """
    Componente de un combo: "este combo lleva N unidades del producto X".

    TRANSACCIONAL: el combo NO tiene stock propio — su disponibilidad es
    CUÁNTOS COMBOS SE PUEDEN ARMAR con el stock actual del local
    (min(stock_componente // cantidad), calculado en routers/productos.py).
    Al pedirlo, la UNA línea de PedidoItem (snapshot de nombre/precio del
    combo) se traduce en un descuento de N unidades de CADA componente
    (ver _movimientos_stock en routers/pedidos.py, que también reintegra
    las unidades si el pedido se cancela o edita).

    La cantidad y el producto que muestra el cliente salen de acá en vivo:
    si el dueño arregla el combo, la web refleja el cambio al instante.
    """

    __tablename__ = "combo_items"

    id = Column(Integer, primary_key=True, index=True)
    combo_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    cantidad = Column(Integer, nullable=False)  # siempre > 0 (valida el router)
    # GRUPO A ELECCIÓN: las filas que comparten el mismo label (ej: "Bebida")
    # son OPCIONES alternativas — el cliente elige UNA. NULL = componente fijo
    # (siempre entra al combo, se descuenta siempre).
    grupo = Column(String(40), nullable=True)

    combo = relationship("Producto", back_populates="combo_items", foreign_keys=[combo_id])
    producto = relationship(
        "Producto",
        back_populates="combos_que_lo_incluyen",
        foreign_keys=[producto_id],
    )

    # Propiedades de lectura: nombre y precio ACTUAL del componente. La web los
    # usa solo para DESCRIBIR el combo ("6x Empanada Carne"); lo que se cobra
    # es el precio del propio combo. Si el dueño cambia el precio de una
    # empanada, la descripción del combo se actualiza sola.
    @property
    def nombre(self) -> str:
        return self.producto.nombre

    @property
    def precio_unitario(self):
        return self.producto.precio

    # Stock ACTUAL del componente: el selector de los grupos a elección lo usa
    # para no ofrecer (por default) una opción que ya no tiene unidades.
    @property
    def stock(self) -> int:
        return self.producto.stock


class Categoria(Base):
    """
    Categorías del menú (Pizza, Empanada, Bebida, Postre...), EDITABLES por el
    dueño desde el dashboard. La tienda las usa para mostrar los productos en
    SECCIONES (una por categoría) ordenadas por `orden`.

    DECISIÓN — match por NOMBRE, sin FK:
      Producto.categoria sigue siendo un String(40) que guarda el nombre de la
      categoría, NO una FK a esta tabla. ¿Por qué? Agregar una FK a una tabla
      existente exigiría recrearla (SQLite no soporta ALTER TABLE ADD CONSTRAINT),
      y el patrón de micromigraciones del proyecto solo permite ADD COLUMN.
      Matchear por nombre es igual de correcto mientras los RENOMBRES se hagan
      por el endpoint PUT, que actualiza en cascada los productos que la usan.

    "combo" es un nombre RESERVADO: esa pseudo-categoría la fija el backend al
    crear combos (los separa del menú común), nunca aparece acá.
    """

    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(40), unique=True, nullable=False, index=True)
    # Menor = la sección aparece antes en la tienda.
    orden = Column(Integer, default=0, nullable=False)


class LocalConfig(Base):
    """
    Datos del local, EDITABLES por el dueño desde el dashboard (Ajustes).
    Patrón singleton: siempre hay una sola fila (id=1). El GET público devuelve
    defaults si la fila no existe todavía, así el frontend nunca se rompe.
    """

    __tablename__ = "local_config"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(120), nullable=False, default="Pizzería El Gordito")
    direccion = Column(String(200), nullable=False, default="")
    telefono = Column(String(30), nullable=False, default="")
    # Número de WhatsApp para recibir los pedidos, formato internacional sin +
    # (ej: "5491100000000"). Si queda vacío, el frontend usa VITE_WA_NUMBER.
    whatsapp = Column(String(30), nullable=False, default="")
    # Radio de delivery APROXIMADO en km, INFORMATIVO (se muestra al cliente,
    # la pizzería confirma el alcance por WhatsApp). 0 = delivery deshabilitado.
    radio_delivery_km = Column(Integer, nullable=False, default=0)
    horarios = Column(String(200), nullable=False, default="")
    descripcion = Column(Text, nullable=False, default="")
    # Logo del local: ruta relativa "/uploads/logo_xxx.png" o "" si no hay.
    # La imagen ES el interruptor: vacío -> el frontend muestra solo el nombre.
    logo_url = Column(String(255), nullable=False, default="")