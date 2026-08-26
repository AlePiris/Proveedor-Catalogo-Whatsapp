"""
Conexión con la base de datos (SQLAlchemy).

Piezas:
  - engine: el "motor" que sabe hablar con Postgres (abre conexiones).
  - SessionLocal: fábrica de sesiones. Una sesión = una unidad de trabajo con
    la DB (un request). Se pide con get_db() y se cierra al terminar.
  - Base: clase base de la que heredan todos los modelos en models.py. El ORM
    la usa para conocer todas las tablas.

DECISIÓN CLAVE — NullPool:
  Usamos poolclass=NullPool, es decir, SIN pool de conexiones. Cada request
  abre y cierra su propia conexión. ¿Por qué, si normalmente un pool acelera
  las cosas? Porque en serverless (Vercel) las funciones son efímeras: si
  dejás conexiones abiertas en un pool, se "cuelgan" cuando la función muere y
  agotan las conexiones de Neon. NullPool evita eso. En dev local también
  funciona perfecto (es ligeramente más lento, pero imperceptible para una
  pizzería). Así usamos el MISMO código en dev y en prod.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool

from app.config import settings

# echo=False: no loguea el SQL a consola (poner True para depurar queries).
engine = create_engine(
    settings.database_url,
    poolclass=NullPool,   # ver explicación arriba
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Base que heredan los modelos.
Base = declarative_base()


def get_db():
    """
    Dependencia de FastAPI: le da a cada endpoint una sesión de DB y la cierra
    al terminar (incluso si hubo error). Uso:
        @router.get("/")
        def algo(db: Session = Depends(get_db)): ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()