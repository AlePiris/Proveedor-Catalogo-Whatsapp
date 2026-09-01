"""
Router de análisis:

  GET /api/admin/analisis/mas-vendidos     ->  top productos por cantidad.
  GET /api/admin/analisis/ventas-por-dia  ->  ventas por día (cuándo se compra más).

Por qué solo pedidos "confirmada": los "pendiente" son pedidos enviados por
WhatsApp que PUEDE que no se hayan concretado. Contarlos inflaría el análisis.
El dueño confirma solo lo que efectivamente vendió -> esa es la fuente de verdad.

Por qué agrupamos por `nombre` (snapshot) y no por `producto_id`: si un producto
se borró, su producto_id ya no existe, pero su nombre quedó en los items y la
venta debe seguir contando. Agrupar por nombre evita perder esa venta histórica.
"""
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Pedido, PedidoItem
from app.schemas import ProductoVendido, VentaPorDia

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


@router.get("/ventas-por-dia", response_model=list[VentaPorDia])
def ventas_por_dia(
    dias: int = Query(7, ge=1, le=90, description="Cuántos días hacia atrás (incluye hoy)"),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Ventas por día (solo confirmadas), para responder "¿cuándo se compra más?".

    Por día: cantidad de pedidos, unidades vendidas (suma de items) e ingreso.
    Los días SIN ventas van incluidos con ceros: así el dueño ve los huecos
    (ej: lunes cerrado) en lugar de un gráfico que "salta" fechas.

    El "día" es el created_at del pedido (cuándo lo hizo el cliente), no el
    confirmada_at: interesa cuándo COMPRA la gente, no cuándo el dueño apretó
    el botón de confirmar.

    Detalle técnico: agrupamos por día en PYTHON y no en SQL porque extraer la
    fecha de un datetime cambia de sintaxis entre motores (SQLite: strftime,
    Postgres: date_trunc) y el proyecto exige SQL portable (ver init_db.py).
    """
    hoy = date.today()
    # Primer día del rango: hace `dias-1` días (el rango incluye hoy).
    desde = hoy - timedelta(days=dias - 1)
    inicio = datetime.combine(desde, time.min)  # desde las 00:00 del primer día

    # Por pedido: fecha, total y unidades (SUM por pedido, portable en ambos motores).
    stmt = (
        select(
            Pedido.created_at,
            Pedido.total,
            func.sum(PedidoItem.cantidad).label("unidades"),
        )
        .outerjoin(PedidoItem, PedidoItem.pedido_id == Pedido.id)
        .where(Pedido.estado == "confirmada", Pedido.created_at >= inicio)
        .group_by(Pedido.id)
    )

    # Acumulado por día (clave "YYYY-MM-DD").
    por_dia: dict[str, dict] = {}
    for f in db.execute(stmt):
        clave = f.created_at.date().isoformat()
        fila = por_dia.setdefault(clave, {"pedidos": 0, "unidades": 0, "ingreso_total": 0})
        fila["pedidos"] += 1
        fila["unidades"] += int(f.unidades or 0)
        fila["ingreso_total"] += f.total or 0

    # Completamos el rango con los días vacíos (en orden cronológico).
    return [
        VentaPorDia(
            fecha=d.isoformat(),
            **por_dia.get(
                d.isoformat(),
                {"pedidos": 0, "unidades": 0, "ingreso_total": 0},
            ),
        )
        for d in (desde + timedelta(days=i) for i in range(dias))
    ]