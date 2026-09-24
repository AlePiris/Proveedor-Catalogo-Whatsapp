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
  - El stock se DESCUENTA al crear el pedido y se REINTEGRA si el dueño
    cancela o edita los items (unidades que no se vendieron vuelven a la venta).
"""
from datetime import datetime, timezone
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Pedido, PedidoItem, Producto, AdminUser
from app.schemas import PedidoCreate, PedidoOut, PedidoUpdate

router = APIRouter(tags=["pedidos"])


# ---------- Helpers ----------
def _resolver_elecciones(combo: Producto, elecciones_in) -> list[dict]:
    """
    Valida las elecciones del cliente contra los GRUPOS del combo y las
    devuelve como dicts listos para serializar en PedidoItem.elecciones:
        [{"grupo": "Empanada", "producto_id": 3, "nombre": "Carne", "cantidad": 3},
         {"grupo": "Empanada", "producto_id": 4, "nombre": "Queso", "cantidad": 3}]

    Un grupo es "N unidades a REPARTIR entre las opciones" (todas las filas
    del grupo comparten la misma cantidad N):
      - 6 empanadas a elección -> vale 3 Carne + 3 Queso, o 6 de una sola.
      - Una bebida a elección (N=1) -> 1 sola unidad de UNA opción.
    Reglas:
      - Por cada grupo, la SUMA de las cantidades elegidas debe dar EXACTO N
        (400 si falta o si se pasa).
      - Cada elección debe ser una OPCION de ese grupo (400 si no).
      - Un combo sin grupos no acepta elecciones (400 si vienen).
    """
    # {grupo: {"n": N, "opciones": {producto_id: Producto}}}
    grupos: dict[str, dict] = {}
    for ci in combo.combo_items:
        if ci.grupo:
            g = grupos.setdefault(ci.grupo, {"n": ci.cantidad, "opciones": {}})
            g["opciones"][ci.producto_id] = ci.producto

    if not grupos:
        if elecciones_in:
            raise HTTPException(
                status_code=400,
                detail=f"'{combo.nombre}' no tiene opciones a elección",
            )
        return []

    # {grupo: {producto_id: cantidad}} — sumamos si viene repetido el producto.
    elegidos: dict[str, dict[int, int]] = {}
    for e in elecciones_in or []:
        g = grupos.get(e.grupo)
        if g is None:
            raise HTTPException(
                status_code=400,
                detail=f"El combo '{combo.nombre}' no tiene el grupo '{e.grupo}'",
            )
        producto = g["opciones"].get(e.producto_id)
        if producto is None:
            raise HTTPException(
                status_code=400,
                detail=f"Ese producto no es una opción de '{e.grupo}' en este combo",
            )
        par = elegidos.setdefault(e.grupo, {})
        par[producto.id] = par.get(producto.id, 0) + e.cantidad

    # La suma de cada grupo debe dar EXACTO las N unidades del lugar.
    problemas = []
    for grupo, g in grupos.items():
        total = sum(elegidos.get(grupo, {}).values())
        if total < g["n"]:
            problemas.append(f"'{grupo}': elegiste {total} de {g['n']}")
        elif total > g["n"]:
            problemas.append(f"'{grupo}': son {g['n']} lugares y elegiste {total}")
    if problemas:
        raise HTTPException(
            status_code=400,
            detail=f"Revisá las opciones a elección ({'; '.join(problemas)})",
        )

    return [
        {
            "grupo": grupo,
            "producto_id": pid,
            "nombre": grupos[grupo]["opciones"][pid].nombre,
            "cantidad": cant,
        }
        for grupo, pares in elegidos.items()
        for pid, cant in pares.items()
    ]


def _construir_items(items_in, db: Session, *, es_admin: bool = False) -> list[PedidoItem]:
    """
    Convierte los items que vienen del cliente/dueño en PedidoItem ORM.
      - Con producto_id: SNAPSHOT de nombre y precio desde la DB (el precio
        vigente lo decide SIEMPRE el backend, no el cliente). 400 si no existe.
        Si es un combo con grupos, valida y guarda las ELECCIONES del cliente.
      - Sin producto_id (ítem "Otro"): SOLO admin (es_admin=True, el editor del
        dueño). Requiere nombre + precio_unitario; queda como snapshot puro.
        El POST público lo rechaza: si no, cualquiera armaría un pedido con
        el precio que quiera desde afuera.
    """
    items_orm = []
    for it in items_in:
        if it.producto_id is None:
            if not es_admin:
                raise HTTPException(
                    status_code=400,
                    detail="Los pedidos online solo incluyen productos del catálogo",
                )
            # Ítem "Otro": el nombre lo escribe el dueño y el precio lo pone él,
            # así que acá SÍ se acepta el precio que viene (es rol admin).
            nombre = (it.nombre or "").strip()
            if not nombre or it.precio_unitario is None or it.precio_unitario < 0:
                raise HTTPException(
                    status_code=400,
                    detail='El ítem "Otro" necesita nombre y precio (el precio puede ser 0)',
                )
            items_orm.append(
                PedidoItem(
                    producto_id=None,       # no sale del catálogo
                    nombre=nombre,
                    cantidad=it.cantidad,
                    precio_unitario=it.precio_unitario,
                )
            )
            continue

        producto = db.query(Producto).filter(Producto.id == it.producto_id).first()
        if producto is None:
            raise HTTPException(
                status_code=400,
                detail=f"Producto {it.producto_id} no existe",
            )
        # Precio vigente: si está en oferta y tiene precio_oferta, uso ese.
        precio = producto.precio_oferta if (producto.en_oferta and producto.precio_oferta) else producto.precio
        # Precio NEGOCIADO (solo admin): el dueño cerró otro precio por
        # WhatsApp. Pisa el snapshot de ESTE pedido; el catálogo queda intacto.
        if es_admin and it.precio_unitario is not None:
            precio = it.precio_unitario
        # Combos con grupos a elección: validamos contra las opciones del dueño
        # y guardamos qué eligió el cliente (se descuenta y reintegra eso).
        elecciones_json = None
        if producto.categoria == "combo":
            resueltas = _resolver_elecciones(producto, it.elecciones)
            if resueltas:
                elecciones_json = json.dumps(resueltas, ensure_ascii=False)
        elif it.elecciones:
            raise HTTPException(
                status_code=400,
                detail=f"'{producto.nombre}' no tiene opciones a elección",
            )
        items_orm.append(
            PedidoItem(
                producto_id=producto.id,
                nombre=producto.nombre,           # snapshot
                cantidad=it.cantidad,
                precio_unitario=precio,           # snapshot
                elecciones=elecciones_json,       # solo combos con grupos
            )
        )
    return items_orm


def _recalcular_total(pedido: Pedido) -> None:
    """Total = suma(cantidad * precio_unitario). Se llama siempre que cambian items."""
    pedido.total = sum(i.cantidad * i.precio_unitario for i in pedido.items)


# ---------- Stock ----------
def _consumo_combo(it: PedidoItem, combo: Producto) -> dict[int, int]:
    """
    Cuánto consume del stock cada unidad del combo según su receta ACTUAL y
    las ELECCIONES guardadas en el item:
      - Componentes FIJOS (grupo NULL): siempre se descuentan (cantidad de la receta).
      - GRUPOS a elección: se descuenta SOLO lo que eligió el cliente (leído del
        JSON `elecciones`, con sus CANTIDADES: 3 Carne + 3 Queso consume eso,
        no 6 de cada una). Si no hay elecciones guardadas (pedido viejo o
        receta cambiada), el grupo NO consume nada — nunca adivinamos.
    """
    # {producto_id: cantidad elegida} de las elecciones guardadas en el item.
    elegidos: dict[int, int] = {}
    if it.elecciones:
        try:
            for e in json.loads(it.elecciones):
                pid = e.get("producto_id")
                cant = e.get("cantidad", 1)
                if isinstance(pid, int) and isinstance(cant, int) and cant > 0:
                    elegidos[pid] = elegidos.get(pid, 0) + cant
        except (TypeError, ValueError):
            pass  # JSON corrupto: tratamos el grupo como sin elección

    consumo: dict[int, int] = {}
    for ci in combo.combo_items:
        if ci.grupo is None:
            consumo[ci.producto_id] = consumo.get(ci.producto_id, 0) + it.cantidad * ci.cantidad
        elif ci.producto_id in elegidos:
            consumo[ci.producto_id] = consumo.get(ci.producto_id, 0) + it.cantidad * elegidos[ci.producto_id]
    return consumo


def _movimientos_stock(items_orm: list[PedidoItem], db: Session) -> list[tuple[Producto, int]]:
    """
    Expande los items de un pedido a MOVIMIENTOS de stock reales (producto,
    cantidad total a mover). La razón de existir de esta función son los
    COMBOS: el combo no tiene stock propio, así que pedirlo se traduce en
    descontar de sus componentes — FIJOS siempre, de los GRUPOS solo la
    opción que eligió el cliente (guardada en el item, ver _consumo_combo).

      - Producto simple: consume su cantidad.
      - Combo: se abre en sus componentes (2 combos de "6 empanadas + 1 coca
        elegida" = 12 empanadas y 2 cocas, no también agua y fanta).
      - Ítem "Otro" (producto_id null) y productos/componentes borrados: se
        ignoran (el item sobrevive como snapshot, no hay stock que tocar).

    Las cantidades se AGRUPAN por producto: si el pedido tiene dos combos que
    comparten un componente (o un combo + el producto suelto), el consumo total
    se calcula junto — y la validación no se puede "saltear" sumando de a poco.
    """
    consumo: dict[int, int] = {}
    for it in items_orm:
        if it.producto_id is None:
            continue
        producto = db.get(Producto, it.producto_id)
        if producto is None:
            continue  # el producto se borró: el item sobrevive como snapshot
        if producto.categoria == "combo":
            for pid, cant in _consumo_combo(it, producto).items():
                consumo[pid] = consumo.get(pid, 0) + cant
        else:
            consumo[producto.id] = consumo.get(producto.id, 0) + it.cantidad
    movimientos = []
    for producto_id, cantidad in consumo.items():
        producto = db.get(Producto, producto_id)
        if producto is not None:  # componente borrado mientras tanto: nada que mover
            movimientos.append((producto, cantidad))
    return movimientos


def _validar_stock(items_orm: list[PedidoItem], db: Session) -> None:
    """
    Antes de crear un pedido (o reemplazar sus items) verifica que haya stock
    para TODOS los movimientos. Si falta, 409 con el producto y lo que queda:
    el cliente puede haber armado el carrito con stock viejo (otro compró antes),
    o el combo pidió más componentes de los que hay en el local.
    """
    for producto, cantidad in _movimientos_stock(items_orm, db):
        if producto.stock < cantidad:
            raise HTTPException(
                status_code=409,
                detail=f"No hay stock suficiente de '{producto.nombre}': quedan {producto.stock}",
            )


def _ajustar_stock(items_orm: list[PedidoItem], db: Session, reintegrar: bool) -> None:
    """
    Mueve el stock de los productos según los items del pedido (los combos a
    través de sus componentes, ver _movimientos_stock).
      reintegrar=False → DESCUENTA (el cliente confirmó el pedido).
      reintegrar=True  → REINTEGRA (el dueño canceló el pedido o reemplazó los
                         items editándolo): esas unidades vuelven al catálogo.

    max(0, ...) protege contra dobles reintegros si algo llega raro.
    """
    for producto, cantidad in _movimientos_stock(items_orm, db):
        delta = cantidad if reintegrar else -cantidad
        producto.stock = max(0, producto.stock + delta)
        # disponible se recalcula igual que en el editor del dueño.
        producto.disponible = producto.stock > 0


def _validar_entrega(db: Session, datos: PedidoCreate) -> tuple[str, str | None]:
    """
    Valida tipo_entrega + direccion:
      - El valor tiene que ser "takeaway" o "delivery" (nada libre).
      - "delivery" = envío al local/comercio que pide (modelo B2B): exige
        dirección a dónde mandar el pedido. Ya no depende del radio de la
        config: el proveedor define a qué locales llega, no un radio geográfico.
    Devuelve (tipo_entrega, direccion_limpia o None) para guardar en el pedido.
    """
    tipo = (datos.tipo_entrega or "takeaway").strip().lower()
    if tipo not in ("takeaway", "delivery"):
        raise HTTPException(status_code=400, detail="tipo_entrega debe ser 'takeaway' o 'delivery'")

    if tipo == "takeaway":
        return tipo, None

    direccion = (datos.direccion or "").strip()
    if not direccion:
        raise HTTPException(status_code=400, detail="El envío requiere la dirección del local")
    return tipo, direccion


def _validar_metodo_pago(metodo: str | None) -> str:
    """
    El pago SIEMPRE es coordinado por WhatsApp (no hay cobro online). Acá solo
    aseguramos que quede registrado un valor conocido para el dashboard.
    """
    metodo = (metodo or "efectivo").strip().lower()
    if metodo not in ("efectivo", "mercado_pago"):
        raise HTTPException(status_code=400, detail="metodo_pago debe ser 'efectivo' o 'mercado_pago'")
    return metodo


# ---------- Públicos ----------
@router.post("/api/pedidos", response_model=PedidoOut, status_code=201)
def crear_pedido(datos: PedidoCreate, db: Session = Depends(get_db)):
    """
    El cliente finaliza el carrito: crea el pedido como 'pendiente'.
    El total se calcula acá (no se confía en el cliente) y el stock de los
    productos se DESCUENTA en el momento (se reintegra si el dueño lo cancela
    o edita los items: esas unidades vuelven a estar a la venta).
    """
    items_orm = _construir_items(datos.items, db)
    tipo_entrega, direccion = _validar_entrega(db, datos)
    metodo_pago = _validar_metodo_pago(datos.metodo_pago)
    _validar_stock(items_orm, db)
    _ajustar_stock(items_orm, db, reintegrar=False)
    pedido = Pedido(
        cliente_nombre=datos.cliente_nombre,
        telefono=(datos.telefono or "").strip(),  # opcional: el contacto real es WhatsApp
        tipo_entrega=tipo_entrega,
        direccion=direccion,
        metodo_pago=metodo_pago,
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
    if datos.metodo_pago is not None:
        pedido.metodo_pago = _validar_metodo_pago(datos.metodo_pago)

    # Reemplazo completo de items (simple y predecible para el frontend).
    if datos.items is not None:
        items_nuevos = _construir_items(datos.items, db, es_admin=True)
        _validar_stock(items_nuevos, db)
        # Los items VIEJOS vuelven al stock (se descuentan los nuevos abajo).
        # Así el editor nunca "pierde" unidades: queda exactamente lo que el
        # pedido nuevo pide, sin importar lo que pedía antes.
        _ajustar_stock(pedido.items, db, reintegrar=True)
        # cascade delete-orphan borra los items viejos al limpiar la lista.
        pedido.items = items_nuevos
        _ajustar_stock(pedido.items, db, reintegrar=False)
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
    """Cancela un pedido pendiente (no se concretó): el stock de sus items
    vuelve al catálogo (se había descontado al crearlo)."""
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    _exigir_pendiente(pedido)
    _ajustar_stock(pedido.items, db, reintegrar=True)
    pedido.estado = "cancelada"
    db.commit()
    db.refresh(pedido)
    return pedido