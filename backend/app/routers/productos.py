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
  POST   /api/productos/{id}/imagen  subir imagen (archivo, AGREGA a la galería;
                                    la primera subida pasa a ser la principal)
  DELETE /api/productos/{id}/imagen/{imagen_id}  borrar UNA foto (fila + archivo)
  PATCH  /api/productos/{id}/imagen/{imagen_id}/principal  elegir la principal
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
import glob
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Producto, ComboItem, ProductoImagen
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

# Los archivos de imágenes se guardan/borran con el helper ÚNICO de app/storage.py:
# en dev escribe el disco (URL relativa /uploads/<archivo>, servida por StaticFiles
# en main.py); en prod (con BLOB_READ_WRITE_TOKEN) sube a Vercel Blob y devuelve la
# URL absoluta de su CDN. El UPLOAD_DIR del módulo storage se lee EN TIEMPO DE
# REQUEST (module attr, no from-import) para que el fixture uploads_dir de los
# tests —que parchea app.storage.UPLOAD_DIR— siga aislando el disco de verdad.
from app import storage


# ---------- Helpers de stock de combos ----------
def _stock_combo_efectivo(combo: Producto) -> int:
    """
    Cuántos combos se pueden armar con el stock ACTUAL del local.
      - Componentes FIJOS: el cuello de botella (min de stock // cantidad).
      - GRUPOS a elección ("N unidades a repartir"): las unidades de TODAS las
        opciones se suman — con 30 carne y 10 queso se arman 6 combos de 6
        (el cliente mezcla gustos, así que da igual de cuál sea cada una).
    Sin componentes (combo a medio armar) -> 0.
    """
    if not combo.combo_items:
        return 0
    fijos: list[int] = []
    por_grupo: dict[str, tuple[int, int]] = {}  # grupo -> (N, stock total)
    for ci in combo.combo_items:
        if ci.grupo:
            n, total = por_grupo.get(ci.grupo, (ci.cantidad, 0))
            por_grupo[ci.grupo] = (n, total + ci.producto.stock)
        else:
            fijos.append(ci.producto.stock // ci.cantidad)
    # Cada grupo aporta su stock total repartido; el combo se arma con el mínimo.
    return min(fijos + [total // n for n, total in por_grupo.values()])


def _aplicar_stock_combos(db: Session, productos: list[Producto]) -> list[Producto]:
    """
    Sobrescribe el `stock` de los combos con el stock EFECTIVO (calculado de
    sus componentes). Así, para el resto de la app — card del cliente, carrito,
    dashboard — el combo "tiene" stock igual que un producto simple, sin
    necesidad de tocar el frontend: la disponibilidad ya es la correcta.

    Detalle: lo hacemos sobre objetos DESACOPLADOS (db.expunge). Mutar .stock
    de una instancia attachada a la sesión podría terminar escribiéndose en la
    DB en el próximo commit; expunge corta ese riesgo (los componentes se
    leen ANTES de expungear, mientras la relación lazy-load sigue viva).
    """
    for p in productos:
        # Forzar la carga de la galería ANTES del expunge: después, el objeto
        # queda detached y no puede lazy-load (Pydantic lo serializa después y
        # reventaría con DetachedInstanceError). Igual que combo_items, que ya
        # se lee antes en _stock_combo_efectivo.
        _ = p.imagenes
        if p.categoria == "combo":
            efectivo = _stock_combo_efectivo(p)
            db.expunge(p)
            p.stock = efectivo
            p.disponible = efectivo > 0
    return productos


# ---------- Públicos ----------
@router.get("", response_model=list[ProductoOut])
def listar_productos(db: Session = Depends(get_db)):
    """
    Lista los productos VISIBLES para el cliente: los que tienen stock > 0,
    más los que el dueño marcó como mostrar_sin_stock (aunque estén en 0).
    Además, TODO lo mostrado debe estar activo (los combos apagados no salen).
    Ordenados: ofertas primero, luego por 'orden' (la sección de combos la
    arma el frontend filtrando categoria='combo').

    Combos: entran al query con su columna stock (siempre 0, ya no la usan) y
    se filtran por su stock EFECTIVO (el que se puede armar con los componentes).
    """
    productos = (
        db.query(Producto)
        .filter(
            or_(
                Producto.stock > 0,
                Producto.mostrar_sin_stock.is_(True),
                Producto.categoria == "combo",  # el filtro real es el stock efectivo
            ),
            Producto.activo.is_(True),
        )
        .order_by(Producto.en_oferta.desc(), Producto.orden.asc())
        .all()
    )
    _aplicar_stock_combos(db, productos)
    # Con el stock efectivo ya calculado, aplica la misma regla de visibilidad
    # que los productos simples (mostrar aunque esté en 0 si el dueño apagó la alarma).
    return [
        p for p in productos
        if p.stock > 0 or p.mostrar_sin_stock
    ]


# Declarado ANTES que /{producto_id} para que "/admin" no choque con el path-param int.
@router.get("/admin", response_model=list[ProductoOut])
def listar_productos_admin(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Lista TODOS los productos (incluye los ocultos por sin-stock) para el
    dueño. Los combos muestran su stock EFECTIVO (cuántos se pueden armar)."""
    productos = (
        db.query(Producto)
        .order_by(Producto.en_oferta.desc(), Producto.orden.asc())
        .all()
    )
    return _aplicar_stock_combos(db, productos)


@router.get("/{producto_id}", response_model=ProductoOut)
def obtener_producto(producto_id: int, db: Session = Depends(get_db)):
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return _aplicar_stock_combos(db, [producto])[0]


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
    # Limpia también los ARCHIVOS de uploads ({id}_<uuid>.<ext>): si no, quedan
    # huérfanos ocupando disco. Las filas de producto_imagenes van por cascade.
    for path in glob.glob(os.path.join(storage.UPLOAD_DIR, f"{producto_id}_*")):
        try:
            os.remove(path)
        except OSError:
            pass
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
    Sube una imagen para el producto. La guarda en backend/uploads/ y la AGREGA
    a la galería (fila en producto_imagenes con ruta relativa /uploads/<archivo>).

    Ya NO pisa la anterior: el producto puede tener varias fotos (la página de
    detalle muestra la galería completa). Solo si es la PRIMERA (sin filas NI
    imagen_url) pasa a ser también la principal (imagen_url, la que ven las
    cards y el carrusel). Para elegir otra principal está el PATCH .../principal.

    NOTA deploy: esto funciona en LOCAL (disco del backend). En Vercel (serverless)
    el disco no persiste entre invocaciones; para producción hay que migrar a
    Vercel Blob (@vercel/blob), que sube el archivo a su CDN y devuelve una URL
    absoluta que se guarda igual en la fila y en imagen_url.
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

    # El helper ÚNICO decide dónde vive el archivo (disco en dev, Blob en prod):
    # la URL que guarda en la fila es la que devuelve.
    url = storage.guardar_archivo(nombre, datos, archivo.content_type)

    # APPEND a la galería. "Sin filas NI imagen_url" (no solo "sin filas"):
    # si el dueño seteó imagen_url a mano por PUT y recién ahora sube una foto,
    # esa foto NO debe robarle la principal.
    es_primera = len(producto.imagenes) == 0 and not producto.imagen_url
    db.add(ProductoImagen(producto_id=producto.id, url=url, orden=len(producto.imagenes)))
    if es_primera:
        producto.imagen_url = url
    db.commit()
    db.refresh(producto)
    return producto


@router.delete("/{producto_id}/imagen/{imagen_id}", status_code=204)
def borrar_imagen(
    producto_id: int,
    imagen_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Borra UNA foto de la galería: la fila Y el archivo físico de uploads (si
    no borramos el archivo, queda huérfano ocupando disco). Si era la PRINCIPAL,
    imagen_url pasa a la foto que queda primera por orden (o None si no queda
    ninguna).
    """
    imagen = db.query(ProductoImagen).filter(
        ProductoImagen.id == imagen_id, ProductoImagen.producto_id == producto_id
    ).first()
    if imagen is None:
        raise HTTPException(status_code=404, detail="Imagen no encontrada")

    # El archivo físico del logo/anterior: lo borra el helper (disco o Blob).
    # try/except adentro: si ya lo borraron a mano, no rompemos por eso.
    storage.borrar_archivo(imagen.url)

    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    era_principal = producto.imagen_url == imagen.url
    db.delete(imagen)
    db.commit()

    if era_principal:
        # La principal cae: promote la siguiente de la galería (por orden, y
        # por id como desempate para fotos subidas con el mismo orden 0).
        siguiente = (
            db.query(ProductoImagen)
            .filter(ProductoImagen.producto_id == producto_id)
            .order_by(ProductoImagen.orden.asc(), ProductoImagen.id.asc())
            .first()
        )
        producto.imagen_url = siguiente.url if siguiente else None
        db.commit()
    return None


@router.patch("/{producto_id}/imagen/{imagen_id}/principal", response_model=ProductoOut)
def marcar_imagen_principal(
    producto_id: int,
    imagen_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    El dueño elige qué foto es la PRINCIPAL (la que ven las cards y el carrusel):
    la movemos al frente del orden de la galería y actualizamos imagen_url.
    """
    producto = db.query(Producto).filter(Producto.id == producto_id).first()
    if producto is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    imagen = next((i for i in producto.imagenes if i.id == imagen_id), None)
    if imagen is None:
        raise HTTPException(status_code=404, detail="Imagen no encontrada")

    producto.imagenes.remove(imagen)
    producto.imagenes.insert(0, imagen)
    # Renumera el orden completo: la elegida queda 0 y el resto la sigue.
    for idx, img in enumerate(producto.imagenes):
        img.orden = idx
    producto.imagen_url = imagen.url
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
    cada producto exista, que el combo no se incluya a sí mismo y la coherencia
    de los GRUPOS a elección: mismo label en varias filas = opciones entre las
    que el cliente elige una. Un grupo necesita al menos 2 opciones (una sola
    no es una elección, es un componente fijo).
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
        # Grupo: label normalizado. Cadena vacía = componente fijo.
        grupo = (it.grupo or "").strip() or None
        filas.append(ComboItem(combo_id=combo_id, producto_id=producto.id, cantidad=it.cantidad, grupo=grupo))
        vistos.add(producto.id)
    if not filas:
        raise HTTPException(status_code=400, detail="Un combo necesita al menos un componente")
    # Coherencia de los grupos de elección: 2+ opciones y MISMA cantidad en
    # todas las filas del grupo (el grupo es "N unidades a repartir": las
    # opciones son alternativas para esos mismos N lugares).
    cantidad_por_grupo: dict[str, int] = {}
    n_por_grupo: dict[str, int] = {}
    for fila in filas:
        if fila.grupo:
            cantidad_por_grupo[fila.grupo] = cantidad_por_grupo.get(fila.grupo, 0) + 1
            previa = n_por_grupo.setdefault(fila.grupo, fila.cantidad)
            if previa != fila.cantidad:
                raise HTTPException(
                    status_code=400,
                    detail=f"Las opciones de '{fila.grupo}' deben tener la misma cantidad ({previa}): son {previa} lugares a repartir",
                )
    for grupo, cantidad in cantidad_por_grupo.items():
        if cantidad < 2:
            raise HTTPException(
                status_code=400,
                detail=f"El grupo '{grupo}' necesita al menos 2 opciones a elección",
            )
    return filas


@combos_router.post("", status_code=201, response_model=ProductoOut)
def crear_combo(
    datos: ComboCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Crea un combo: una fila en productos (categoria='combo') + componentes.
    El combo NO tiene stock propio: su disponibilidad se calcula desde el
    stock de sus componentes (ver _stock_combo_efectivo)."""
    if datos.precio <= 0:
        raise HTTPException(status_code=400, detail="El precio del combo debe ser mayor a 0")
    componentes = _construir_combo_items(datos.items, None, db)
    combo = Producto(
        nombre=datos.nombre,
        descripcion=datos.descripcion,
        precio=datos.precio,
        stock=0,                    # columna ignorada: el stock sale de los componentes
        categoria="combo",          # fija: así el frontend lo separa en su sección
        etiqueta=datos.etiqueta,
        imagen_url=datos.imagen_url,
        disponible=True,            # la visibilidad real la decide el stock efectivo
    )
    combo.combo_items = componentes
    db.add(combo)
    db.commit()
    db.refresh(combo)
    # La respuesta lleva el stock EFECTIVO (los GETs ya lo calculan así).
    return _aplicar_stock_combos(db, [combo])[0]


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
    return _aplicar_stock_combos(db, [combo])[0]


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
    return _aplicar_stock_combos(db, [combo])[0]


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