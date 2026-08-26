"""
Carga datos de ejemplo: el admin dueño y un catálogo inicial.

Uso (correr local):
    python -m app.seed

Es idempotente: si el admin o los productos ya existen, no los duplica.
El admin arranca con admin / admin123 (solo para desarrollo; en producción
definir un password fuerte o cargarlo por variable de entorno).
"""
from app.database import SessionLocal
from app.models import Producto, AdminUser
from app.auth import hash_password


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


def main():
    db = SessionLocal()
    try:
        # Admin: solo si no existe ya.
        if db.query(AdminUser).filter(AdminUser.username == "admin").first() is None:
            db.add(AdminUser(
                username="admin",
                password_hash=hash_password("admin123"),
                nombre="Dueño de la pizzería",
            ))
            print("Admin creado: admin / admin123")
        else:
            print("El admin ya existe (no se recrea).")

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

        db.commit()
        print("Seed listo.")
    finally:
        db.close()


if __name__ == "__main__":
    main()