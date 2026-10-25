"""
Fixtures compartidas de la suite de tests.

Aislamiento total (requisito del spec):
  - Cada test corre contra una base SQLite EN MEMORIA propia: el esquema se
    crea al empezar y se borra al terminar. La base real de desarrollo
    (DATABASE_URL del .env) NUNCA se toca.
  - Los archivos subidos van a un directorio TEMPORAL por test:
    backend/uploads/ real queda intacto.

DECISIÓN TÉCNICA — StaticPool: app/database.py usa NullPool (una conexión
por request, decisión serverless-safe). Con SQLite en memoria y NullPool,
cada conexión vería una base DISTINTA (la base muere con la conexión) y los
endpoints fallarían con "no such table". StaticPool comparte UNA conexión
para todo el test: el esquema creado es visible desde todos los requests.
Ver docs/superpowers/specs/2026-09-24-backend-tests-design.md.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import crear_token, hash_password
from app.database import Base, get_db
from app.main import app
from app.models import AdminUser


@pytest.fixture()
def engine():
    """Engine de test: SQLite en memoria, UNA conexión compartida (StaticPool).

    check_same_thread=False: TestClient atiende los requests en otro hilo
    que el del test, y SQLite en memoria por defecto lo prohíbe.
    """
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


@pytest.fixture()
def uploads_dir(tmp_path, monkeypatch):
    """Directorio temporal de uploads: guardar_archivo/borrar_archivo (app.storage,
    helper único que usan productos/logo) escriben y borran acá, nunca en
    backend/uploads/ real. Los tests pueden usar el Path devuelto para verificar
    los archivos físicos."""
    carpeta = tmp_path / "uploads"
    carpeta.mkdir()
    monkeypatch.setattr("app.storage.UPLOAD_DIR", str(carpeta))
    return carpeta


@pytest.fixture()
def cliente(engine, uploads_dir):
    """TestClient con get_db overridada hacia la base de test y esquema fresco.

    create_all al empezar y drop_all al terminar = aislamiento total: ningún
    test depende de otro ni de datos previos. La override de get_db hace que
    todos los endpoints de la app real (routers, auth, modelos) trabajen con
    sesiones del engine de test.
    """
    Base.metadata.create_all(bind=engine)
    SesionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def get_db_test():
        db = SesionTest()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = get_db_test
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def admin_headers(cliente, engine):
    """Admin real + token firmado de verdad: cada request admin ejercita el
    stack JWT completo (oauth2_scheme -> get_admin_actual), sin mockear auth.

    Depende de `cliente` para asegurar que el esquema ya existe cuando se
    crea el AdminUser (el orden de fixtures lo garantiza pytest).
    """
    SesionTest = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = SesionTest()
    db.add(
        AdminUser(
            username="tester",
            password_hash=hash_password("secreto123"),
            nombre="Tester",  # columna NOT NULL sin default
        )
    )
    db.commit()
    admin_id = db.query(AdminUser).filter(AdminUser.username == "tester").first().id
    db.close()
    return {"Authorization": f"Bearer {crear_token(admin_id)}"}


@pytest.fixture()
def crear_producto(cliente, admin_headers):
    """Fábrica: crea un producto simple vía la API admin (el setup también
    ejercita el endpoint de crear) y devuelve el JSON de la respuesta.

    Defaults pensados para no chocar con validaciones: precio entero y
    stock 10. Cualquier campo se puede pisar: crear_producto(stock=0).
    """

    def _crear(**overrides):
        datos = {
            "nombre": "Producto de test",
            "precio": 1000,
            "stock": 10,
            "categoria": "varios",
        }
        datos.update(overrides)
        resp = cliente.post("/api/productos", json=datos, headers=admin_headers)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _crear


@pytest.fixture()
def combo_armado(cliente, admin_headers, crear_producto):
    """Combo de test: 6 empanadas a elección (carne/queso) + 1 bebida a
    elección (coca/agua) + un postre FIJO. Los stocks están elegidos para
    que el cuello de botella sea un componente distinto por caso.

    Stock efectivo esperado (regla de _stock_combo_efectivo):
      - Empanada (N=6, grupo): total 30 + 10 = 40 -> 40 // 6 = 6
        (las unidades de TODAS las opciones del grupo se SUMAN)
      - Bebida (N=1, grupo): total 5 + 20 = 25 -> 25 // 1 = 25
      - Postre fijo: 4 // 1 = 4  <- cuello de botella del combo
    """
    carne = crear_producto(nombre="Carne", stock=30, precio=500)
    queso = crear_producto(nombre="Queso", stock=10, precio=500)
    coca = crear_producto(nombre="Coca 1.5L", stock=5, precio=1200)
    agua = crear_producto(nombre="Agua", stock=20, precio=800)
    postre = crear_producto(nombre="Flan", stock=4, precio=900)
    resp = cliente.post(
        "/api/combos",
        json={
            "nombre": "Combo test",
            "precio": 3500,
            "items": [
                {"producto_id": carne["id"], "cantidad": 6, "grupo": "Empanada"},
                {"producto_id": queso["id"], "cantidad": 6, "grupo": "Empanada"},
                {"producto_id": coca["id"], "cantidad": 1, "grupo": "Bebida"},
                {"producto_id": agua["id"], "cantidad": 1, "grupo": "Bebida"},
                {"producto_id": postre["id"], "cantidad": 1},
            ],
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return {
        "combo": resp.json(),
        "carne": carne["id"],
        "queso": queso["id"],
        "coca": coca["id"],
        "agua": agua["id"],
        "postre": postre["id"],
    }