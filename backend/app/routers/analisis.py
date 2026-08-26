"""
Router de análisis. Solo un endpoint, pero importante:

  GET /api/admin/analisis/mas-vendidos  ->  top productos por cantidad.

Por qué solo pedidos "confirmada": los "pendiente" son pedidos enviados por
WhatsApp que PUEDE que no se hayan concretado. Contarlos inflaría el análisis.
El dueño confirma solo lo que efectivamente vendió -> esa es la fuente de verdad.

Por qué agrupamos por `nombre` (snapshot) y no por `producto_id`: si un producto
se borró, su producto_id ya no existe, pero su nombre quedó en los items y la
venta debe seguir contando. Agrupar por nombre evita perder esa venta histórica.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Pedido, PedidoItem
from app.schemas import ProductoVendido

router = APIRouter(prefix="/api/admin/analisis", tags=["analisis"])


@router.get("/mas-vendidos", response_model=list[ProductoVendido])
def mas_vendidos(
    limite: int = Query(10, ge=1, le=100),
    desde: Optional[str] = Query(None, description="ISO, ej. 2026-01-01"),
    hasta: Optional[str] = Query(None, description="ISO, ej. 2026-12-31"),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Top productos vendidos (solo confirmados), por cantidad descendente.
    Suma cantidad_total y ingreso_total (cantidad * precio_unitario) por nombre.
    """
    # El ingreso por item se calcula en SQL con func.sum(cantidad * precio_unitario).
    stmt = (
        select(
            PedidoItem.nombre,
            func.sum(PedidoItem.cantidad).label("cantidad_total"),
            func.sum(PedidoItem.cantidad * PedidoItem.precio_unitario).label("ingreso_total"),
        )
        .join(Pedido, PedidoItem.pedido_id == Pedido.id)
        .where(Pedido.estado == "confirmada")
    )

    # Filtro opcional por fecha de confirmación (va antes del limit por claridad;
    # en SQL el WHERE siempre se aplica antes del LIMIT igual).
    if desde:
        stmt = stmt.where(Pedido.confirmada_at >= datetime.fromisoformat(desde))
    if hasta:
        stmt = stmt.where(Pedido.confirmada_at <= datetime.fromisoformat(hasta))

    stmt = stmt.group_by(PedidoItem.nombre).order_by(
        func.sum(PedidoItem.cantidad).desc()
    ).limit(limite)

    filas = db.execute(stmt).all()
    return [
        ProductoVendido(
            nombre=f.nombre,
            cantidad_total=int(f.cantidad_total or 0),
            ingreso_total=f.ingreso_total or 0,
        )
        for f in filas
    ]