"""
Carga datos de ejemplo: el admin dueño y un catálogo inicial.

Uso (correr local):
    python -m app.seed

Es idempotente: si el admin o los productos ya existen, no los duplica.

CREDENCIALES (sin hardcodeo, spec deploy §4a): el admin se crea leyendo
ADMIN_USERNAME y ADMIN_PASSWORD del entorno/.env — el seed corta con error
claro si falta alguna, ANTES de tocar la DB. Si el admin ya existe, no se
lo toca (la password la maneja el dueño desde la web).
"""
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import Producto, AdminUser, LocalConfig, Categoria
from app.auth import hash_password

# Fila única de config del local: se crea SOLO si no existe, con campos vacíos
# para que el dueño los complete desde Ajustes. Nota: el GET público tampoco
# necesita esta fila (devuelve defaults si falta), esto es para que Ajustes
# arranca con una fila ya persistida.
LOCAL_DEFAULT = dict(
    id=1,
    nombre="Pizzería El Gordito",
    direccion="Av. Siempre Viva 742",
    telefono="11 5555-5555",
    whatsapp="",
    radio_delivery_km=3,
    horarios="Lun a Dom, 19:00 a 23:00",
    descripcion="Pizzas caseras a horno de leña.",
)


# Categorías base del menú: el `orden` decide en qué posición aparece la
# sección en la tienda (menor = antes). Los nombres DEBEN matchear el valor
# `categoria` de los productos del CATALOGO de abajo (match por nombre).
CATEGORIAS_BASE = [
    ("pizza", 1),
    ("empanada", 2),
    ("bebida", 3),
    ("postre", 4),
]

CATALOGO = [
    # (nombre, descripcion, precio, precio_oferta, en_oferta, stock, categoria, orden)
    ("Pizza Muzzarella", "Salsa de tomate y muzzarella", 8500, 7000, True, 20, "pizza", 1),
    ("Pizza Napolitana", "Muzzarella, tomate, ajo y orégano", 9500, None, False, 15, "pizza", 2),
    ("Pizza Calabresa", "Muzzarella y longaniza", 10000, None, False, 15, "pizza", 3),
    ("Empanada Carne", "Carne cortada a cuchillo", 1500, 1200, True, 50, "empanada", 10),
    ("Empanada Pollo", "Pollo y verdura", 1400, None, False, 50, "empanada", 11),
    ("Empanada Jamón y Queso", "Jamón y muzzarella", 1500, None, False, 40, "empanada", 12),
    ("Coca 1.5L", "Bebida cola 1.5 litros", 3500, None, False, 30, "bebida", 20),
    ("Agua sin gas 500ml", "Agua mineral", 2000, None, False, 30, "bebida", 21),
    ("Flan casero", "Flan con dulce o crema", 3000, None, False, 10, "postre", 30),
    ("Helado 1kg", "A elegir sabor", 6000, None, False, 8, "postre", 31),
]


def crear_admin(db: Session) -> None:
    """Busca y crea el admin por settings.admin_username con hash de
    settings.admin_password. Si ya existe NO lo toca: la password del dueño
    (ya cambiada desde la web, quizá) sigue su curso."""
    if db.query(AdminUser).filter(AdminUser.username == settings.admin_username).first() is None:
        db.add(AdminUser(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            nombre="Dueño",
        ))
        print(f"Admin creado: {settings.admin_username}")
        # flush (no commit): main() hace el commit al final. Con flush queda
        # VISIBLE para las queries de la misma sesión aunque llegue un
        # rollback/cierre antes — y los tests (autoflush=False) lo ven igual.
        db.flush()
    else:
        print("El admin ya existe (no se recrea).")


def main():
    # Validar credenciales ANTES de abrir la sesión: el seed en prod no debe
    # conectarse (ni a medio conectar cortarse) por falta de configuración.
    if not settings.admin_username:
        raise SystemExit("Falta ADMIN_USERNAME — definila en backend/.env o en las env vars (ver .env.example)")
    if not settings.admin_password:
        raise SystemExit("Falta ADMIN_PASSWORD — definila en backend/.env o en las env vars (ver .env.example)")

    db = SessionLocal()
    try:
        crear_admin(db)

        # Categorías: las base solo si no existe NINGUNA (si el dueño borró o
        # renombró categorías a mano, no las volvemos a meter).
        if db.query(Categoria).count() == 0:
            for nombre, orden in CATEGORIAS_BASE:
                db.add(Categoria(nombre=nombre, orden=orden))
            print(f"Cargadas {len(CATEGORIAS_BASE)} categorías base.")
        else:
            print("Ya hay categorías (no se duplican).")

        # Productos: solo si la tabla está vacía.
        if db.query(Producto).count() == 0:
            for p in CATALOGO:
                db.add(Producto(
                    nombre=p[0], descripcion=p[1], precio=p[2],
                    precio_oferta=p[3], en_oferta=p[4], stock=p[5],
                    categoria=p[6], orden=p[7],
                    disponible=(p[5] > 0),
                ))
            print(f"Cargados {len(CATALOGO)} productos.")
        else:
            print("Ya hay productos (no se duplican).")

        # Config del local: solo si no existe la fila única (id=1).
        if db.query(LocalConfig).filter(LocalConfig.id == 1).first() is None:
            db.add(LocalConfig(**LOCAL_DEFAULT))
            print("Config del local creada (editala desde Ajustes).")
        else:
            print("La config del local ya existe (no se recrea).")

        db.commit()
        print("Seed listo.")
    finally:
        db.close()


if __name__ == "__main__":
    main()