"""
Crea todas las tablas en la base de datos.

Uso (correr local):
    python -m app.init_db

Por qué NO se ejecuta solo al arrancar la API:
  En serverless (Vercel) no hay un "arranque" persistente; cada invocación es
  fría y efímera. Crear tablas en cada invocación desperdiciaría recursos. Por
  eso esto se corre a mano (contra dev o contra Neon) cuando cambian los modelos.

  Para producción real se usaría Alembic (migraciones versionadas), pero para el
  alcance de la facultad, create_all() es suficiente y más simple de explicar.
"""
from app.database import Base, engine
# Importar los modelos para que Base los conozca antes de create_all.
# (Si no se importan, SQLAlchemy no sabe que existen y no crea las tablas.)
from app.models import Producto, AdminUser, Pedido, PedidoItem  # noqa: F401


def main():
    print("Creando tablas en:", engine.url)
    Base.metadata.create_all(bind=engine)
    print("Listo.")


if __name__ == "__main__":
    main()