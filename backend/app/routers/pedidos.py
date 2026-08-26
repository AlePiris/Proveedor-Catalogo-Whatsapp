"""
Router de pedidos.

Endpoints PÚBLICOS (los llama el cliente al enviar por WhatsApp):
  POST /api/pedidos          crea un pedido "pendiente"

Endpoints de ADMIN (los usa el dueño en el dashboard):
  GET   /api/admin/pedidos            lista (filtrable por ?estado=)
  GET   /api/admin/pedidos/{id}       detalle con items
  PUT   /api/admin/pedidos/{id}       edita items/notas (para que coincida con WhatsApp)
  PATCH /api/admin/pedidos/{id}/confirmar   pasa a "confirmada"
  PATCH /api/admin/pedidos/{id}/cancelar     pasa a "cancelada"

Reglas de negocio:
  - El precio lo decide el BACKEND (snapshot), no el cliente.
  - El total se recalcula desde los items (crear/editar/confirmar).
  - Editar y confirmar solo se permiten si el pedido está "pendiente".
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Pedido, PedidoItem, Producto, AdminUser
from app.schemas import PedidoCreate, PedidoOut, PedidoUpdate

router = APIRouter(tags=["pedidos"])


# ---------- Helpers ----------
def _construir_items(items_in, db: Session) -> list[PedidoItem]:
    """
    Convierte los items que vienen del cliente (producto_id + cantidad) en
    PedidoItem ORM, tomando el SNAPSHOT de nombre y precio de la DB.
    Lanza 400 si algún producto no existe.
    """
    items_orm = []
    for it in items_in:
        producto = db.query(Producto).filter(Producto.id == it.producto_id).first()
        if producto is None:
            raise HTTPException(
                status_code=400,
                detail=f"Producto {it.producto_id} no existe",
            )
        # Precio vigente: si está en oferta y tiene precio_oferta, uso ese.
        precio = producto.precio_oferta if (producto.en_oferta and producto.precio_oferta) else producto.precio
        items_orm.append(
            PedidoItem(
                producto_id=producto.id,
                nombre=producto.nombre,           # snapshot
                cantidad=it.cantidad,
                precio_unitario=precio,           # snapshot
            )
        )
    return items_orm


def _recalcular_total(pedido: Pedido) -> None:
    """Total = suma(cantidad * precio_unitario). Se llama siempre que cambian items."""
    pedido.total = sum(i.cantidad * i.precio_unitario for i in pedido.items)


# ---------- Públicos ----------
@router.post("/api/pedidos", response_model=PedidoOut, status_code=201)
def crear_pedido(datos: PedidoCreate, db: Session = Depends(get_db)):
    """
    El cliente finaliza el carrito: crea el pedido como 'pendiente'.
    El total se calcula acá (no se confía en el cliente).
    """
    items_orm = _construir_items(datos.items, db)
    pedido = Pedido(
        cliente_nombre=datos.cliente_nombre,
        telefono=datos.telefono,
        notas=datos.notas,
        estado="pendiente",
        items=items_orm,
    )
    _recalcular_total(pedido)
    db.add(pedido)
    db.commit()
    db.refresh(pedido)
    return pedido


# ---------- Admin ----------
@router.get("/api/admin/pedidos", response_model=list[PedidoOut])
def listar_pedidos(
    estado: str | None = Query(None, description="pendiente|confirmada|cancelada"),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Lista pedidos. Si viene ?estado= filtra; si no, trae todos (más nuevos primero)."""
    q = db.query(Pedido)
    if estado:
        q = q.filter(Pedido.estado == estado)
    return q.order_by(Pedido.created_at.desc()).all()


@router.get("/api/admin/pedidos/{pedido_id}", response_model=PedidoOut)
def obtener_pedido(
    pedido_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return pedido


def _exigir_pendiente(pedido: Pedido) -> None:
    """Solo se puede editar/confirmar/cancelar un pedido pendiente."""
    if pedido.estado != "pendiente":
        raise HTTPException(
            status_code=400,
            detail=f"El pedido ya está '{pedido.estado}', no se puede modificar",
        )


@router.put("/api/admin/pedidos/{pedido_id}", response_model=PedidoOut)
def editar_pedido(
    pedido_id: int,
    datos: PedidoUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    El dueño ajusta el pedido para que coincida con lo convenido por WhatsApp
    (sumó/sacó items, cambió cantidad). Reemplaza la lista de items completa.
    """
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    _exigir_pendiente(pedido)

    if datos.cliente_nombre is not None:
        pedido.cliente_nombre = datos.cliente_nombre
    if datos.telefono is not None:
        pedido.telefono = datos.telefono
    if datos.notas is not None:
        pedido.notas = datos.notas

    # Reemplazo completo de items (simple y predecible para el frontend).
    if datos.items is not None:
        # cascade delete-orphan borra los items viejos al limpiar la lista.
        pedido.items = _construir_items(datos.items, db)
        _recalcular_total(pedido)

    db.commit()
    db.refresh(pedido)
    return pedido


@router.patch("/api/admin/pedidos/{pedido_id}/confirmar", response_model=PedidoOut)
def confirmar_pedido(
    pedido_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Confirma la venta. Solo los confirmados alimentan el análisis."""
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    _exigir_pendiente(pedido)
    _recalcular_total(pedido)  # el total "real" queda fijado al confirmar
    pedido.estado = "confirmada"
    pedido.confirmada_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(pedido)
    return pedido


@router.patch("/api/admin/pedidos/{pedido_id}/cancelar", response_model=PedidoOut)
def cancelar_pedido(
    pedido_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Cancela un pedido pendiente (no se concretó)."""
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    _exigir_pendiente(pedido)
    pedido.estado = "cancelada"
    db.commit()
    db.refresh(pedido)
    return pedido