"""
Router de config del local (datos que el dueño edita desde Ajustes).

Endpoints:
  GET  /api/config       PÚBLICO  → el footer, /contacto y el carrito lo leen.
  PUT  /api/config       ADMIN    → el dueño guarda los cambios desde el dashboard.
  POST /api/config/logo  ADMIN    → sube el logo del local (una sola imagen).
  DELETE /api/config/logo ADMIN   → quita el logo (archiva y borra el archivo).

Patrón singleton: la tabla local_config SIEMPRE tiene una fila (id=1). Para
que el GET nunca falle ni dependa de haber corrido el seed, si no existe la
fila se devuelve un objeto por defecto EN MEMORIA (sin escribir en la DB).
El PUT crea la fila si todavía no existe (upsert).

LOGO — la imagen ES el interruptor (sin toggle aparte):
  logo_url == ""  →  no hay logo (GET lo devuelve vacío, el frontend muestra
  solo el nombre). Subir una nueva REEMPLAZA la anterior borrando su archivo
  (no quedan huérfanos en disco, mismo cuidado que los uploads de productos).
"""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import LocalConfig
from app.schemas import ConfigOut, ConfigUpdate

# UPLOAD_DIR vive en el router de productos y es quien sirve /uploads. Lo
# leemos en tiempo de REQUEST (atributo del módulo, no from-import) para que
# el fixture uploads_dir de los tests —que parchea app.routers.productos.
# UPLOAD_DIR— siga aislando también estos endpoints.
from app.routers import productos as router_productos

router = APIRouter(tags=["config"])

# Valores por defecto: se muestran si el dueño todavía no guardó nada. Sirven
# como plantilla para que en Ajustes él solo complete sus datos reales.
DEFAULTS = dict(
    id=1,
    nombre="Pizzería El Gordito",
    direccion="",
    telefono="",
    whatsapp="",
    radio_delivery_km=0,
    horarios="",
    descripcion="",
    logo_url="",
)


def _obtener_fila(db: Session) -> LocalConfig:
    """Devuelve la fila única, creándola con defaults si no existe."""
    fila = db.query(LocalConfig).filter(LocalConfig.id == 1).first()
    if fila is None:
        fila = LocalConfig(**DEFAULTS)
        db.add(fila)
        db.commit()
        db.refresh(fila)
    return fila


@router.get("/api/config", response_model=ConfigOut)
def obtener_config(db: Session = Depends(get_db)):
    """Público: datos del local. Sin fila en DB devuelve defaults (no rompe)."""
    fila = db.query(LocalConfig).filter(LocalConfig.id == 1).first()
    if fila is None:
        # Objeto en memoria, SIN commit: un GET no debe escribir en la DB.
        return ConfigOut(**DEFAULTS)
    return fila


@router.put("/api/config", response_model=ConfigOut)
def actualizar_config(
    datos: ConfigUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Admin: actualiza solo los campos que vienen (resto quedan como estaban)."""
    fila = _obtener_fila(db)
    cambios = datos.model_dump(exclude_unset=True)
    if not cambios:
        raise HTTPException(status_code=400, detail="No se envió ningún campo para actualizar")
    for campo, valor in cambios.items():
        setattr(fila, campo, valor)
    db.commit()
    db.refresh(fila)
    return fila


# ---------- Logo del local ----------
def _guardar_archivo(archivo: UploadFile, datos: bytes) -> str:
    """Valida la imagen, la guarda en uploads con nombre único logo_<uuid>.<ext>
    y devuelve su ruta relativa ("/uploads/logo_xxx.png"). Reutiliza el mismo
    UPLOAD_DIR y las mismas validaciones que las fotos de productos."""
    if not archivo.content_type or not archivo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")
    if len(datos) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La imagen supera los 5 MB")

    ext = os.path.splitext(archivo.filename or "")[1].lower() or ".png"
    nombre = f"logo_{uuid.uuid4().hex}{ext}"
    upload_dir = router_productos.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    with open(os.path.join(upload_dir, nombre), "wb") as f:
        f.write(datos)
    return f"/uploads/{nombre}"


def _quitar_archivo_logo(url: str | None) -> None:
    """Borra el archivo físico del logo ("/uploads/x" -> uploads/x). try/except:
    si ya lo borraron a mano, no rompemos por eso (mismo criterio que productos)."""
    if not url:
        return
    archivo = os.path.join(router_productos.UPLOAD_DIR, url.rsplit("/", 1)[-1])
    try:
        os.remove(archivo)
    except OSError:
        pass


def _guardar_logo(fila: LocalConfig, db: Session, archivo: UploadFile, datos: bytes) -> ConfigOut:
    """Reemplaza el logo: borra el archivo ANTERIOR (si había), guarda el nuevo
    y persiste la ruta. Un solo punto para POST (subida) — lo usa el router."""
    url = _guardar_archivo(archivo, datos)
    _quitar_archivo_logo(fila.logo_url)
    fila.logo_url = url
    db.commit()
    db.refresh(fila)
    return fila


@router.post("/api/config/logo", response_model=ConfigOut)
async def subir_logo(
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Admin: sube (o reemplaza) el logo del local. Devuelve la config con
    logo_url apuntando al archivo nuevo."""
    fila = _obtener_fila(db)
    datos = await archivo.read()
    return _guardar_logo(fila, db, archivo, datos)


@router.delete("/api/config/logo", response_model=ConfigOut)
def borrar_logo(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Admin: quita el logo — la URL vuelve a "" y el archivo se borra de disco.
    Borrar sin logo no es error: el estado final (sin logo) ya es la realidad."""
    fila = _obtener_fila(db)
    _quitar_archivo_logo(fila.logo_url)
    fila.logo_url = ""
    db.commit()
    db.refresh(fila)
    return fila