"""
Router de config del local (datos que el dueño edita desde Ajustes).

Endpoints:
  GET /api/config   PÚBLICO  → el footer, /contacto y el carrito lo leen.
  PUT /api/config   ADMIN    → el dueño guarda los cambios desde el dashboard.

Patrón singleton: la tabla local_config SIEMPRE tiene una fila (id=1). Para
que el GET nunca falle ni dependa de haber corrido el seed, si no existe la
fila se devuelve un objeto por defecto EN MEMORIA (sin escribir en la DB).
El PUT crea la fila si todavía no existe (upsert).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import LocalConfig
from app.schemas import ConfigOut, ConfigUpdate

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