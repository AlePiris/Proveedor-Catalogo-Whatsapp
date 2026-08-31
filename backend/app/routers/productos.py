"""
Router de productos.

Endpoints PÚBLICOS (la tienda):
  GET  /api/productos        lista ordenada (ofertas primero)
  GET  /api/productos/{id}   detalle

Endpoints de ADMIN (requieren token):
  GET    /api/productos/admin        listar TODOS (incluye ocultos por sin-stock)
  POST   /api/productos            crear
  PUT    /api/productos/{id}       editar (precio, stock, etc.)
  PATCH  /api/productos/{id}/oferta  marcar/desmarcar oferta + precio
  POST   /api/productos/{id}/imagen  subir imagen (archivo)
  DELETE /api/productos/{id}       borrar

Combos (categoria="combo"): precio propio + componentes en combo_items.
  POST   /api/combos               crear combo
  PUT    /api/combos/{id}          editar combo (items = reemplazo completo)
  PATCH  /api/combos/{id}/activo   activar/desactivar el combo
  DELETE /api/combos/{id}          borrar combo (y sus items, por cascade)

El orden "ofertas primero" se logra ordenando por (en_oferta DESC, orden ASC):
las ofertas (True=1) quedan arriba, y dentro de cada grupo, por el campo orden.

Visibilidad para el cliente (endpoint público): un producto se muestra solo si
Tiene stock > 0, O si el dueño activó `mostrar_sin_stock` (desactivó la alarma).
Los que no se muestran, el dueño igual los ve en /api/productos/admin.
"""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Producto, ComboItem
from app.schemas import (
    ProductoCreate,
    ProductoOut,
    ProductoUpdate,
    OfertaUpdate,
    ComboCreate,
    ComboUpdate,
    ComboActivoUpdate,
)
from app.config import settings

router = APIRouter(prefix="/api/productos", tags=["productos"])
combos_router = APIRouter(prefix="/api/combos", tags=["combos"])

# Carpeta donde se guardan las imágenes subidas. En dev local se sirve desde
# acá (ver StaticFiles en main.py). En Vercel (serverless) esto NO persiste:
# para producción hay que migrar a Vercel Blob (guarda en su CDN y devuelve una URL).
#
# OJO con la profundidad de dirname: __file__ es app/routers/productos.py, así que
#   dirname 1 -> app/routers
#   dirname 2 -> app
#   dirname 3 -> backend   <- la carpeta que queremos (donde main.py monta /uploads)
# Si nos quedamos en 2 dirnames, las imágenes se guardan en app/uploads pero el
# server las sirve de backend/uploads -> 404 y no se ven. Por eso 3 dirnames.
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads")


# ---------- Públicos ----------
@router.get("", response_model=list[ProductoOut])
def listar_productos(db: Session = Depends(get_db)):
    """
    Lista los productos VISIBLES para el cliente: los que tienen stock > 0,
    más los que el dueño marcó como mostrar_sin_stock (aunque estén en 0).
    Además, TODO lo mostrado debe estar activo (los combos apagados no salen).
    Ordenados: ofertas primero, luego por 'orden' (la sección de combos la
    arma el frontend filtrando categoria='combo').
    """
    return (
        db.query(Producto)
        .filter(
            or_(Producto.stock > 0, Producto.mostrar_sin_stock.is_(True)),
            Producto.activo.is_(True),
        )
        .order_by(Producto.en_oferta.desc(), Producto.orden.asc())
        .all()
    )


# Declarado ANTES que /{producto_id} para que "/admin" no choque con el path-param int.
@router.get("/admin", response_model=list[ProductoOut])
def listar_productos_admin(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Lista TODOS los productos (incluye los ocultos por sin-stock) para el dueño."""
    return (
        db.query(Producto)
        .order_by(Producto.en_oferta.desc(), Producto.orden.asc())
        .all()
    )


@router.get("/{producto_id}", response_model=ProductoOut)
def obtener_producto(producto_id: int, db: Session = Depends(get_db)):
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return producto


# ---------- Admin ----------
@router.post("", response_model=ProductoOut, status_code=201)
def crear_producto(
    datos: ProductoCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Crea un producto. require_admin garantiza que solo el dueño lo haga."""
    producto = Producto(**datos.model_dump())
    db.add(producto)
    db.commit()
    db.refresh(producto)  # recarga para tener el id asignado
    return producto


@router.put("/{producto_id}", response_model=ProductoOut)
def editar_producto(
    producto_id: int,
    datos: ProductoUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Edita un producto. Solo actualiza los campos que vengan en el body."""
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    # model_dump(exclude_unset=True) trae solo los campos que se mandaron, no
    # los que quedaron en None por default. Así no pisamos con None lo que no se tocó.
    for campo, valor in datos.model_dump(exclude_unset=True).items():
        setattr(producto, campo, valor)
    db.commit()
    db.refresh(producto)
    return producto


@router.patch("/{producto_id}/oferta", response_model=ProductoOut)
def cambiar_oferta(
    producto_id: int,
    datos: OfertaUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Marca/desmarca un producto como oferta y (opcional) su precio de oferta."""
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    producto.en_oferta = datos.en_oferta
    if datos.en_oferta:
        producto.precio_oferta = datos.precio_oferta  # puede ser None si no se manda
    else:
        producto.precio_oferta = None  # al sacar la oferta, limpiamos el precio
    db.commit()
    db.refresh(producto)
    return producto


@router.delete("/{producto_id}", status_code=204)
def borrar_producto(
    producto_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Borra un producto. Los pedidos históricos sobreviven (snapshot + FK null).
    Si era componente de algún combo, se quita de esos combos (cascade manual:
    un combo con un componente borrado describiría algo ya inexistente).
    """
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    # Quita este producto de los combos que lo incluían. (El snapshot del
    # PedidoItem NO se toca: los pedidos históricos quedan intactos.)
    db.query(ComboItem).filter(ComboItem.producto_id == producto_id).delete()
    db.delete(producto)
    db.commit()
    return None


@router.post("/{producto_id}/imagen", response_model=ProductoOut)
async def subir_imagen(
    producto_id: int,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Sube una imagen para el producto. La guarda en backend/uploads/ y guarda
    su ruta relativa (/uploads/<archivo>) en imagen_url.

    NOTA deploy: esto funciona en LOCAL (disco del backend). En Vercel (serverless)
    el disco no persiste entre invocaciones; para producción hay que migrar a
    Vercel Blob (@vercel/blob), que sube el archivo a su CDN y devuelve una URL
    absoluta que se guarda igual en imagen_url.
    """
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    # Validación básica: solo imágenes, hasta ~5 MB.
    if not archivo.content_type or not archivo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")
    datos = await archivo.read()
    if len(datos) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La imagen supera los 5 MB")

    # Nombre único: <id>_<uuid>.<ext>. Evita colisiones y caracteres raros.
    ext = os.path.splitext(archivo.filename or "")[1].lower() or ".jpg"
    nombre = f"{producto_id}_{uuid.uuid4().hex}{ext}"

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, nombre), "wb") as f:
        f.write(datos)

    # Guardamos ruta relativa. En dev la sirve StaticFiles montado en /uploads.
    producto.imagen_url = f"/uploads/{nombre}"
    db.commit()
    db.refresh(producto)
    return producto


### ---------- Combos (admin): categoria fija "combo" + componentes ----------

# Helpers de combos
def _obtener_combo(db: Session, combo_id: int) -> Producto:
    combo = db.query(Producto).filter(Producto.id == combo_id, Producto.categoria == "combo").first()
    if combo is None:
        raise HTTPException(status_code=404, detail="Combo no encontrado")
    return combo


def _construir_combo_items(items_in, combo_id: int | None, db: Session) -> list[ComboItem]:
    """
    Convierte los componentes que manda el dueño en ComboItem ORM. Valida que
    cada producto exista y que el combo no se incluya a sí mismo.
    """
    filas: list[ComboItem] = []
    vistos: set[int] = set()
    for it in items_in:
        if it.producto_id in vistos:
            raise HTTPException(status_code=400, detail="El combo no puede repetir el mismo producto (suma las cantidades)")
        if it.producto_id == combo_id:
            raise HTTPException(status_code=400, detail="El combo no puede incluirse a sí mismo")
        producto = db.query(Producto).filter(
            Producto.id == it.producto_id, Producto.categoria != "combo"
        ).first()
        if producto is None:
            raise HTTPException(status_code=400, detail=f"Producto {it.producto_id} no existe (o es otro combo)")
        filas.append(ComboItem(combo_id=combo_id, producto_id=producto.id, cantidad=it.cantidad))
        vistos.add(producto.id)
    if not filas:
        raise HTTPException(status_code=400, detail="Un combo necesita al menos un componente")
    return filas


@combos_router.post("", status_code=201, response_model=ProductoOut)
def crear_combo(
    datos: ComboCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Crea un combo: una fila en productos (categoria='combo') + componentes."""
    if datos.precio <= 0:
        raise HTTPException(status_code=400, detail="El precio del combo debe ser mayor a 0")
    componentes = _construir_combo_items(datos.items, None, db)
    combo = Producto(
        nombre=datos.nombre,
        descripcion=datos.descripcion,
        precio=datos.precio,
        stock=datos.stock,
        categoria="combo",          # fija: así el frontend lo separa en su sección
        etiqueta=datos.etiqueta,
        imagen_url=datos.imagen_url,
        disponible=datos.stock > 0,
    )
    combo.combo_items = componentes
    db.add(combo)
    db.commit()
    db.refresh(combo)
    return combo


@combos_router.put("/{combo_id}", response_model=ProductoOut)
def editar_combo(
    combo_id: int,
    datos: ComboUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Edita el combo. Si vienen `items`, se reemplazan TODOS los componentes
    (mismo patrón que PedidoUpdate): simple y predecible.
    """
    combo = _obtener_combo(db, combo_id)
    cambios = datos.model_dump(exclude_unset=True)
    # Sacamos "items" ANTES de dump: model_dump convierte los ComboItemIn en
    # dicts y perdemos el atributo .producto_id. Usamos el campo del schema
    # (objetos pydantic), que es lo que _construir_combo_items espera.
    hay_items = "items" in cambios
    cambios.pop("items", None)
    for campo, valor in cambios.items():
        setattr(combo, campo, valor)

    if hay_items:
        if len(datos.items) == 0:
            raise HTTPException(status_code=400, detail="Un combo necesita al menos un componente")
        combo.combo_items = _construir_combo_items(datos.items, combo_id, db)

    db.commit()
    db.refresh(combo)
    return combo


@combos_router.patch("/{combo_id}/activo", response_model=ProductoOut)
def cambiar_activo(
    combo_id: int,
    datos: ComboActivoUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Enciende/apaga el combo manualmente (la promo del festivo se saca el
    día siguiente sin borrarlo ni perder su receta).
    """
    combo = _obtener_combo(db, combo_id)
    combo.activo = datos.activo
    db.commit()
    db.refresh(combo)
    return combo


@combos_router.delete("/{combo_id}", status_code=204)
def borrar_combo(
    combo_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Borra el combo (sus combo_items van por cascade). Pedidos históricos intactos."""
    combo = _obtener_combo(db, combo_id)
    db.delete(combo)  # cascade delete-orphan borra sus combo_items
    db.commit()
    return None