"""
Crea todas las tablas en la base de datos y aplica micromigraciones.

Uso (correr local):
    python -m app.init_db

Por qué NO se ejecuta solo al arrancar la API:
  En serverless (Vercel) no hay un "arranque" persistente; cada invocación es
  fría y efímera. Crear tablas en cada invocación desperdiciaría recursos. Por
  eso esto se corre a mano (contra dev o contra Neon) cuando cambian los modelos.

  Para producción real se usaría Alembic (migraciones versionadas), pero para el
  alcance de la facultad, create_all() es suficiente y más simple de explicar.

MICROMIGRACIONES:
  create_all() crea tablas NUEVAS pero NO agrega columnas a tablas que ya
  existen (limitación conocida de SQLAlchemy). Cuando agregamos columnas a una
  tabla con datos (ej: tipo_entrega en pedidos), hay que hacer ALTER TABLE. Lo
  listamos acá abajo: cada entry dice tabla/columna y el SQL del ALTER; se
  inspecciona qué columnas existen y se aplican SOLO las que faltan, de forma
  idempotente (se puede correr este script las veces que sea, no rompe nada).
"""
from sqlalchemy import text

from app.database import Base, engine
# Importar los modelos para que Base los conozca antes de create_all.
# (Si no se importan, SQLAlchemy no sabe que existen y no crea las tablas.)
from app.models import (  # noqa: F401
    Producto,
    AdminUser,
    Pedido,
    PedidoItem,
    LocalConfig,
    ComboItem,
    Categoria,
    ProductoImagen,
)

# Cada tupla: (tabla, columna, SQL completo del ALTER).
# El SQL tiene que ser valido para TODOS los motores posibles (SQLite local y
# Postgres/Neon en prod). ADD COLUMN con CONSTANTES es lo mas portable.
MICROMIGRACIONES = [
    (
        "pedidos",
        "tipo_entrega",
        "ALTER TABLE pedidos ADD COLUMN tipo_entrega VARCHAR(20) DEFAULT 'takeaway' NOT NULL",
    ),
    (
        "pedidos",
        "direccion",
        "ALTER TABLE pedidos ADD COLUMN direccion VARCHAR(200)",
    ),
    (
        "pedidos",
        "metodo_pago",
        "ALTER TABLE pedidos ADD COLUMN metodo_pago VARCHAR(30) DEFAULT 'efectivo' NOT NULL",
    ),
    (
        "productos",
        "etiqueta",
        "ALTER TABLE productos ADD COLUMN etiqueta VARCHAR(60) DEFAULT '' NOT NULL",
    ),
    (
        "productos",
        "activo",
        "ALTER TABLE productos ADD COLUMN activo BOOLEAN DEFAULT 1 NOT NULL",
    ),
    (
        "combo_items",
        "grupo",
        "ALTER TABLE combo_items ADD COLUMN grupo VARCHAR(40)",
    ),
    (
        "pedido_items",
        "elecciones",
        "ALTER TABLE pedido_items ADD COLUMN elecciones TEXT",
    ),
]


def _columnas_existentes(conn, tabla: str) -> set[str]:
    """Devuelve el set de nombres de columna de una tabla, portable por motor."""
    from sqlalchemy import inspect
    insp = inspect(conn)
    return {c["name"] for c in insp.get_columns(tabla)}


def main():
    print("Creando tablas en:", engine.url)
    Base.metadata.create_all(bind=engine)

    # Micromigraciones: ALTER TABLE solo para las columnas que falten.
    with engine.begin() as conn:
        tablas_cache: dict[str, set[str]] = {}
        for tabla, columna, sql in MICROMIGRACIONES:
            if tabla not in tablas_cache:
                tablas_cache[tabla] = _columnas_existentes(conn, tabla)
            if columna in tablas_cache[tabla]:
                continue
            print(f"  Migrando: {tabla}.{columna} ...")
            conn.execute(text(sql))
            tablas_cache[tabla].add(columna)

    # Backfill multi-imagen: los productos HISTÓRICOS tienen su foto solo en
    # productos.imagen_url (la tabla producto_imagenes ni existía). Les
    # insertamos esa URL como única fila de la galería. Es idempotente (NOT
    # EXISTS: solo productos sin filas). Los archivos huérfanos de uploads
    # (fotos pisadas por el upload único de antes) NO se asocian: ya no
    # sabemos cuál era la principal; el dueño las resube si las quiere.
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO producto_imagenes (producto_id, url, orden, created_at)
            SELECT p.id, p.imagen_url, 0, CURRENT_TIMESTAMP
            FROM productos p
            WHERE p.imagen_url IS NOT NULL
              AND p.imagen_url != ''
              AND NOT EXISTS (
                  SELECT 1 FROM producto_imagenes pi WHERE pi.producto_id = p.id
              )
        """))

    print("Listo.")


if __name__ == "__main__":
    main()