"""
Router de categorías del menú (Pizza, Empanada, Bebida, Postre...).

Endpoints:
  GET    /api/categorias          PÚBLICO → la tienda lo usa para armar las
                                          secciones del catálogo (ordenadas).
  POST   /api/categorias          ADMIN   → el dueño crea una categoría nueva.
  PUT    /api/categorias/{id}     ADMIN   → renombrar/reordenar. El rename se
                                          propaga a los productos que la usan.
  DELETE /api/categorias/{id}     ADMIN   → solo si no queda ningún producto en
                                          esa categoría (evita "huérfanos").

"combo" es un nombre RESERVADO (ver models.py): no se puede crear/renombrar a
"combo" porque el backend usa ese string para separar los combos del menú.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Categoria, Producto
from app.schemas import CategoriaCreate, CategoriaOut, CategoriaUpdate

router = APIRouter(prefix="/api/categorias", tags=["categorias"])

# Pseudo-categoría con lógica propia en el backend (sección de combos).
RESERVADOS = {"combo"}


@router.get("", response_model=list[CategoriaOut])
def listar_categorias(db: Session = Depends(get_db)):
    """Público: todas las categorías, ordenadas por `orden` (y nombre de desempate)."""
    return (
        db.query(Categoria)
        .order_by(Categoria.orden.asc(), Categoria.nombre.asc())
        .all()
    )


@router.post("", response_model=CategoriaOut, status_code=201)
def crear_categoria(
    datos: CategoriaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Admin: crea una categoría. El nombre es único (case-insensitive a efectos
    prácticos: guardamos el string tal cual llegó, pero no permitimos duplicados
    que solo difieran en mayúsculas, para que el select del admin no muestre
    "casi iguales")."""
    nombre = datos.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    if nombre.lower() in RESERVADOS:
        raise HTTPException(status_code=400, detail="'combo' es un nombre reservado")

    existe = (
        db.query(Categoria)
        .filter(func.lower(Categoria.nombre) == nombre.lower())
        .first()
    )
    if existe:
        raise HTTPException(status_code=409, detail=f"La categoría '{nombre}' ya existe")

    fila = Categoria(nombre=nombre, orden=datos.orden)
    db.add(fila)
    db.commit()
    db.refresh(fila)
    return fila


@router.put("/{categoria_id}", response_model=CategoriaOut)
def actualizar_categoria(
    categoria_id: int,
    datos: CategoriaUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Admin: renombrar y/o reordenar. Si cambia el nombre, se actualizan EN
    CASCADA los productos con el nombre anterior (así el match por nombre entre
    Producto.categoria y Categoria.nombre nunca se rompe)."""
    fila = db.get(Categoria, categoria_id)
    if fila is None:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    cambios = datos.model_dump(exclude_unset=True)
    if not cambios:
        raise HTTPException(status_code=400, detail="No se envió ningún campo para actualizar")

    nuevo_nombre = cambios.pop("nombre", None)
    if nuevo_nombre is not None:
        nuevo_nombre = nuevo_nombre.strip()
        if not nuevo_nombre:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        if nuevo_nombre.lower() in RESERVADOS:
            raise HTTPException(status_code=400, detail="'combo' es un nombre reservado")
        # Unicidad: solo importa si el nombre realmente cambia.
        if nuevo_nombre != fila.nombre:
            existe = (
                db.query(Categoria)
                .filter(func.lower(Categoria.nombre) == nuevo_nombre.lower())
                .first()
            )
            if existe:
                raise HTTPException(status_code=409, detail=f"La categoría '{nuevo_nombre}' ya existe")
            # Cascada: los productos que usaban el nombre viejo pasan al nuevo.
            db.query(Producto).filter(Producto.categoria == fila.nombre).update(
                {"categoria": nuevo_nombre}
            )
            fila.nombre = nuevo_nombre

    if "orden" in cambios:
        fila.orden = cambios["orden"]

    db.commit()
    db.refresh(fila)
    return fila


@router.delete("/{categoria_id}", status_code=204)
def borrar_categoria(
    categoria_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Admin: borra la categoría SOLO si no queda ningún producto en ella. Si
    tiene productos, el dueño debe moverlos o borrarlos primero (así ningún
    producto queda apuntando a una categoría que no existe en el listado)."""
    fila = db.get(Categoria, categoria_id)
    if fila is None:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    en_uso = (
        db.query(Producto)
        .filter(Producto.categoria == fila.nombre)
        .count()
    )
    if en_uso > 0:
        raise HTTPException(
            status_code=400,
            detail=f"La categoría '{fila.nombre}' tiene {en_uso} producto(s). "
                   "Movelos o borralos primero.",
        )

    db.delete(fila)
    db.commit()