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

# El guardado/borrado físico pasa por el helper ÚNICO de app/storage.py (disco
# en dev, Vercel Blob en prod). Se usa en tiempo de REQUEST, sin from-import del
# UPLOAD_DIR: el fixture uploads_dir de los tests parchea app.storage.UPLOAD_DIR.
from app.storage import guardar_archivo, borrar_archivo

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
def _armar_nombre_logo(archivo: UploadFile) -> str:
    """Nombre único logo_<uuid>.<ext>. La VALIDACIÓN de tipo/tamaño es de este
    endpoint; el helper de storage solo decide dónde se escribe (disco/Blob).
    Extensión fallback ".png"."""
    ext = os.path.splitext(archivo.filename or "")[1].lower() or ".png"
    return f"logo_{uuid.uuid4().hex}{ext}"


@router.post("/api/config/logo", response_model=ConfigOut)
async def subir_logo(
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Admin: sube (o reemplaza) el logo del local. Valida imagen <= 5 MB, guarda
    con el helper ÚNICO de app/storage.py (disco en dev, Vercel Blob en prod),
    borra el archivo del logo ANTERIOR si había, y devuelve la config nueva."""
    if not archivo.content_type or not archivo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen")
    datos = await archivo.read()
    if len(datos) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La imagen supera los 5 MB")

    fila = _obtener_fila(db)
    url = guardar_archivo(_armar_nombre_logo(archivo), datos, archivo.content_type)
    borrar_archivo(fila.logo_url)
    fila.logo_url = url
    db.commit()
    db.refresh(fila)
    return fila


@router.delete("/api/config/logo", response_model=ConfigOut)
def borrar_logo(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Admin: quita el logo — la URL vuelve a "" y el archivo se borra de disco
    o Blob. Borrar sin logo no es error: ese estado ya es la realidad."""
    fila = _obtener_fila(db)
    borrar_archivo(fila.logo_url)
    fila.logo_url = ""
    db.commit()
    db.refresh(fila)
    return fila