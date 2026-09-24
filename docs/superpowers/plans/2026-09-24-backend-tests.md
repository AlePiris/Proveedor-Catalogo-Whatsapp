# Subsistema de Tests del Backend — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una suite pytest que corre desde `backend/`, aislada de la base real, cubriendo galería de imágenes, stock de combos y ciclo de vida de pedidos.

**Architecture:** `TestClient` de FastAPI contra `app.main:app` real, con `get_db` overridada hacia un engine SQLite en memoria con `StaticPool` (esquema creado/destruido por test). Auth real (AdminUser + JWT firmado), uploads a directorio temporal.

**Tech Stack:** Python + pytest + httpx (TestClient) + SQLAlchemy (StaticPool) sobre el stack existente (FastAPI, bcrypt, python-jose).

**Spec:** `docs/superpowers/specs/2026-09-24-backend-tests-design.md`

## Global Constraints

- Los tests NUNCA tocan la base de desarrollo (`DATABASE_URL` del `.env`) ni `backend/uploads/` real.
- Cada test es independiente: esquema `create_all`/`drop_all` por test; ningún test depende de otro.
- Comandos de Python SIEMPRE vía el venv del proyecto: `venv/Scripts/python.exe -m pytest ...` corriendo desde `backend/`.
- Dependencias de test van en `backend/requirements-dev.txt` (el `requirements.txt` de producción no se toca).
- Comentarios de los tests en español, con el estilo didáctico del proyecto (explicar el porqué, no solo el qué).
- **Si un test falla, encontró un bug real: NO se edita el test para que pase. Parar, investigar con systematic-debugging y reportar al dueño del proyecto.** La suite documenta comportamiento actual; cambiar comportamiento es otro task.
- Códigos de estado que fija este plan (leídos del código real): 400 validación, 401 sin token admin, 404 no existe, 409 stock insuficiente, 201 creado.

## Review Focus

Inputs que el spec implica pero ningún caso obvio ejercita — cada línea tiene su test en el task dueño:

1. Token admin inválido/vencido → 401 (no 500 ni 403). Test: `test_token_invalido_401` (Task 2).
2. Subir imagen a un producto inexistente → 404, no crash. Test: `test_subir_producto_inexistente_404` (Task 2).
3. `tipo_entrega="delivery"` sin dirección → 400. Test: `test_delivery_sin_direccion_400` (Task 4).
4. `metodo_pago` fuera de ("efectivo", "mercado_pago") → 400. Test: `test_metodo_pago_invalido_400` (Task 4).
5. Editar/cancelar un pedido ya confirmado → 400 controlado (no 500 ni silencio). Test: `test_confirmar_fija_estado` (Task 4).

---

### Task 1: Infraestructura de test (harnés)

**Files:**
- Create: `backend/requirements-dev.txt`
- Modify: `backend/pyproject.toml` (agregar sección al final)
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_salud.py`

**Interfaces:**
- Consumes: `app.main.app`, `app.database.{Base, get_db}`, `app.auth.{crear_token, hash_password}`, `app.models.AdminUser`, `app.routers.productos.UPLOAD_DIR` (global de módulo, monkeypatcheable).
- Produces (los Tasks 2-4 dependen de estas fixtures, nombres exactos):
  - `cliente` → `fastapi.testclient.TestClient` (app real, DB overridada, esquema fresco)
  - `engine` → `sqlalchemy.Engine` (SQLite memoria, StaticPool)
  - `admin_headers` → `dict` `{"Authorization": "Bearer <token>"}`
  - `uploads_dir` → `pathlib.Path` del directorio temporal de uploads
  - `crear_producto` → callable `crear_producto(**overrides) -> dict` (JSON del producto creado; defaults: `nombre="Producto de test"`, `precio=1000`, `stock=10`, `categoria="varios"`)
  - `combo_armado` → `dict` con keys `"combo"` (JSON del combo), `"carne"`, `"queso"`, `"coca"`, `"agua"`, `"postre"` (ids de los componentes) — se agrega en el Task 3.

- [ ] **Step 1: Crear `backend/requirements-dev.txt`**

```
# Dependencias SOLO de desarrollo/tests. La app en producción usa requirements.txt.
# Instalar: venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Framework de tests: descubre y corre tests/test_*.py.
pytest

# Cliente HTTP que usa fastapi.testclient.TestClient para llamar a los
# endpoints sin levantar servidor.
httpx
```

- [ ] **Step 2: Agregar config de pytest a `backend/pyproject.toml`**

Agregar al final del archivo existente (conserva `[tool.vercel]` tal cual):

```toml

# Corre de tests: venv\Scripts\python.exe -m pytest (desde backend/).
[tool.pytest.ini_options]
testpaths = ["tests"]
# pythonpath: para que `import app.main` resuelva sin instalar el paquete.
pythonpath = ["."]
```

- [ ] **Step 3: Instalar dependencias de test**

Run: `cd backend && venv/Scripts/python.exe -m pip install -r requirements-dev.txt`
Expected: instala pytest e httpx sin errores.

- [ ] **Step 4: Crear `backend/tests/conftest.py`**

```python
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
    """Directorio temporal de uploads: subir_imagen/borrar_imagen escriben
    y borran acá, nunca en backend/uploads/ real. Los tests pueden usar el
    Path devuelto para verificar los archivos físicos."""
    carpeta = tmp_path / "uploads"
    carpeta.mkdir()
    monkeypatch.setattr("app.routers.productos.UPLOAD_DIR", str(carpeta))
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
```

- [ ] **Step 5: Crear `backend/tests/test_salud.py` (smoke del harnés)**

```python
"""
Smoke tests del ARNÉS de test: si algo de acá falla, el problema es de
conftest.py (base, override, auth), no de la app. Validan el circuito
completo antes de escribir tests de negocio.
"""


def test_health_responde_ok(cliente):
    resp = cliente.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_admin_token_valido_accede(cliente, admin_headers):
    resp = cliente.get("/api/productos/admin", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 6: Correr la suite**

Run: `cd backend && venv/Scripts/python.exe -m pytest -v`
Expected: `2 passed` (los 2 smoke tests).

- [ ] **Step 7: Commit**

```bash
git add backend/requirements-dev.txt backend/pyproject.toml backend/tests/conftest.py backend/tests/test_salud.py
git commit -m "feat: arnes de tests del backend (pytest + TestClient + SQLite memoria)

Fixture de base aislada por test (StaticPool resuelve el NullPool +
SQLite en memoria), auth real con token firmado y uploads a directorio
temporal. Smoke tests validan el circuito completo.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Tests de la galería de imágenes

**Files:**
- Create: `backend/tests/test_galeria.py`

**Interfaces:**
- Consumes: fixtures `cliente`, `admin_headers`, `crear_producto`, `uploads_dir` (Task 1).
- Produces: nada (archivo de tests autocontenido; helpers locales `_subir`).

- [ ] **Step 1: Crear `backend/tests/test_galeria.py`**

```python
"""
Tests de la galería de imágenes (endpoints admin de /api/productos).

Regla que fijan (spec, sección "Enfoque A"): `productos.imagen_url` es la
PRINCIPAL (denormalizada; la leen cards, carrusel y carrito) y
`producto_imagenes` es la fuente de verdad de la GALERÍA. Toda la
sincronización entre ambas vive en el router; estos tests la pinnean.
"""

# PNG mínimo: la validación del endpoint es por content_type (image/*); el
# contenido alcanza con una cabecera no vacía.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _subir(cliente, admin_headers, producto_id, nombre="foto.png"):
    """Sube una imagen PNG de test al producto. Devuelve la respuesta."""
    return cliente.post(
        f"/api/productos/{producto_id}/imagen",
        files={"archivo": (nombre, PNG, "image/png")},
        headers=admin_headers,
    )


def test_subir_primera_imagen_pasa_a_ser_principal(cliente, admin_headers, crear_producto):
    p = crear_producto()
    resp = _subir(cliente, admin_headers, p["id"])
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo["imagenes"]) == 1
    assert cuerpo["imagenes"][0]["orden"] == 0
    # La primera subida es también la principal (la que ven las cards).
    assert cuerpo["imagen_url"] == cuerpo["imagenes"][0]["url"]


def test_subir_segunda_no_roba_la_principal(cliente, admin_headers, crear_producto):
    p = crear_producto()
    primera = _subir(cliente, admin_headers, p["id"]).json()
    segunda = _subir(cliente, admin_headers, p["id"]).json()
    assert len(segunda["imagenes"]) == 2
    # Append a la galería: la principal sigue siendo la primera.
    assert segunda["imagen_url"] == primera["imagen_url"]
    assert segunda["imagenes"][1]["orden"] == 1


def test_subir_no_imagen_rechazado(cliente, admin_headers, crear_producto):
    p = crear_producto()
    resp = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("datos.txt", b"hola", "text/plain")},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_subir_producto_inexistente_404(cliente, admin_headers):
    assert _subir(cliente, admin_headers, 999999).status_code == 404


def test_marcar_principal_reordena(cliente, admin_headers, crear_producto):
    p = crear_producto()
    _subir(cliente, admin_headers, p["id"])
    segunda = _subir(cliente, admin_headers, p["id"]).json()["imagenes"][1]
    resp = cliente.patch(
        f"/api/productos/{p['id']}/imagen/{segunda['id']}/principal",
        headers=admin_headers,
    )
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["imagen_url"] == segunda["url"]
    # Renumera el orden completo: la elegida queda 0 y el resto la sigue.
    assert [i["orden"] for i in cuerpo["imagenes"]] == [0, 1]


def test_borrar_principal_promueve_siguiente(cliente, admin_headers, crear_producto):
    p = crear_producto()
    _subir(cliente, admin_headers, p["id"])
    cuerpo = _subir(cliente, admin_headers, p["id"]).json()
    principal, segunda = cuerpo["imagenes"]
    resp = cliente.delete(
        f"/api/productos/{p['id']}/imagen/{principal['id']}", headers=admin_headers
    )
    assert resp.status_code == 204
    detalle = cliente.get(f"/api/productos/{p['id']}").json()
    assert detalle["imagen_url"] == segunda["url"]


def test_borrar_unica_imagen_deja_sin_principal(cliente, admin_headers, crear_producto):
    p = crear_producto()
    cuerpo = _subir(cliente, admin_headers, p["id"]).json()
    resp = cliente.delete(
        f"/api/productos/{p['id']}/imagen/{cuerpo['imagenes'][0]['id']}",
        headers=admin_headers,
    )
    assert resp.status_code == 204
    detalle = cliente.get(f"/api/productos/{p['id']}").json()
    assert detalle["imagen_url"] is None
    assert detalle["imagenes"] == []


def test_borrar_imagen_inexistente_404(cliente, admin_headers, crear_producto):
    p = crear_producto()
    resp = cliente.delete(f"/api/productos/{p['id']}/imagen/999999", headers=admin_headers)
    assert resp.status_code == 404


def test_archivos_fisicos_viven_y_mueren_con_las_filas(
    cliente, admin_headers, crear_producto, uploads_dir
):
    p = crear_producto()
    cuerpo = _subir(cliente, admin_headers, p["id"]).json()
    # El archivo físico existe en el directorio de uploads (temporal).
    assert len(list(uploads_dir.glob(f"{p['id']}_*"))) == 1
    # Se borra junto con la fila (no quedan huérfanos en disco).
    cliente.delete(
        f"/api/productos/{p['id']}/imagen/{cuerpo['imagenes'][0]['id']}",
        headers=admin_headers,
    )
    assert len(list(uploads_dir.glob(f"{p['id']}_*"))) == 0
    # Borrar el PRODUCTO limpia todos sus archivos de una vez.
    _subir(cliente, admin_headers, p["id"])
    _subir(cliente, admin_headers, p["id"])
    cliente.delete(f"/api/productos/{p['id']}", headers=admin_headers)
    assert len(list(uploads_dir.glob(f"{p['id']}_*"))) == 0


def test_endpoints_admin_sin_token_401(cliente, crear_producto):
    p = crear_producto()
    assert cliente.get("/api/productos/admin").status_code == 401
    assert _subir(cliente, {}, p["id"]).status_code == 401
    # Con un token basura también es 401 (JWT mal formado, no 500).
    resp = _subir(cliente, {"Authorization": "Bearer no-es-un-token"}, p["id"])
    assert resp.status_code == 401
```

- [ ] **Step 2: Correr los tests nuevos**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_galeria.py -v`
Expected: `10 passed`. Si alguno falla, es un bug encontrado: **no editar el test** — investigar y reportar (ver Global Constraints).

- [ ] **Step 3: Correr la suite completa (los smoke siguen verdes)**

Run: `cd backend && venv/Scripts/python.exe -m pytest -v`
Expected: `12 passed`.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_galeria.py
git commit -m "test: galeria de imagenes - principal, promocion, archivos fisicos

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Tests del stock de combos

**Files:**
- Modify: `backend/tests/conftest.py` (agregar fixture `combo_armado`)
- Create: `backend/tests/test_combos.py`

**Interfaces:**
- Consumes: fixtures del Task 1.
- Produces: fixture `combo_armado` en `conftest.py` (la consume el Task 4). Retorna `dict` con keys `"combo"` (JSON del combo, incluye `"id"` y `"precio"`), `"carne"`, `"queso"`, `"coca"`, `"agua"`, `"postre"` (ids `int` de los componentes).

- [ ] **Step 1: Agregar la fixture `combo_armado` al final de `backend/tests/conftest.py`**

```python
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
```

- [ ] **Step 2: Crear `backend/tests/test_combos.py`**

```python
"""
Tests del stock EFECTIVO de combos y la visibilidad del catálogo público.

Regla que fijan (spec): el combo NO tiene stock propio; cuántos se pueden
armar sale de sus componentes (mínimo entre fijos y grupos, con las
unidades de un grupo SUMADAS). El catálogo público solo muestra lo
vendible; el admin lo ve todo.
"""


def _ids_publicos(cliente):
    """Ids de los productos que ve el CLIENTE (catálogo público)."""
    return {p["id"] for p in cliente.get("/api/productos").json()}


def _ids_admin(cliente, admin_headers):
    """Ids de TODOS los productos (los ocultos incluidos) para el dueño."""
    return {
        p["id"]
        for p in cliente.get("/api/productos/admin", headers=admin_headers).json()
    }


def test_stock_efectivo_es_el_minimo_de_componentes(cliente, combo_armado):
    detalle = cliente.get(f"/api/productos/{combo_armado['combo']['id']}").json()
    # El postre fijo (4) es el cuello de botella, aunque el grupo Empanada
    # alcance para 6 y el de Bebida para 25. Si las opciones de un grupo se
    # contaran como mínimo en vez de SUMA, daría 1 y este test fallaría.
    assert detalle["stock"] == 4
    assert detalle["disponible"] is True


def test_combo_agotado_desaparece_del_publico(cliente, admin_headers, combo_armado):
    combo_id = combo_armado["combo"]["id"]
    assert combo_id in _ids_publicos(cliente)  # sanity: arranca visible
    # Se agota el cuello de botella (postre fijo).
    cliente.put(
        f"/api/productos/{combo_armado['postre']}",
        json={"stock": 0},
        headers=admin_headers,
    )
    assert combo_id not in _ids_publicos(cliente)
    # El dueño lo sigue viendo en el admin (para reponer y reactivar).
    assert combo_id in _ids_admin(cliente, admin_headers)


def test_combo_desactivado_no_aparece_publico(cliente, admin_headers, combo_armado):
    combo_id = combo_armado["combo"]["id"]
    cliente.patch(
        f"/api/combos/{combo_id}/activo", json={"activo": False}, headers=admin_headers
    )
    assert combo_id not in _ids_publicos(cliente)
    assert combo_id in _ids_admin(cliente, admin_headers)


def test_producto_simple_sin_stock_oculto(cliente, admin_headers, crear_producto):
    p = crear_producto(stock=0)
    assert p["id"] not in _ids_publicos(cliente)
    # mostrar_sin_stock lo devuelve a vitrina (el dueño apagó la alarma).
    cliente.put(
        f"/api/productos/{p['id']}",
        json={"mostrar_sin_stock": True},
        headers=admin_headers,
    )
    assert p["id"] in _ids_publicos(cliente)
```

- [ ] **Step 3: Correr los tests nuevos**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_combos.py -v`
Expected: `4 passed`.

- [ ] **Step 4: Correr la suite completa**

Run: `cd backend && venv/Scripts/python.exe -m pytest -v`
Expected: `16 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_combos.py
git commit -m "test: stock efectivo de combos y visibilidad del catalogo publico

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Tests del ciclo de vida de pedidos

**Files:**
- Create: `backend/tests/test_pedidos.py`

**Interfaces:**
- Consumes: fixtures del Task 1 + `combo_armado` (Task 3; shape: keys `"combo"`, `"carne"`, `"queso"`, `"coca"`, `"agua"`, `"postre"`).
- Produces: nada (archivo de tests autocontenido; helpers locales `_crear_pedido` y `_stock`).

- [ ] **Step 1: Crear `backend/tests/test_pedidos.py`**

```python
"""
Tests del ciclo de vida de pedidos: precios snapshot que fija el BACKEND,
descuento de stock al crear, reintegro al cancelar/editar y validación de
las elecciones de grupos de combos.

Contratos que pinnean (routers/pedidos.py):
  - El total lo calcula SIEMPRE el backend desde el precio vigente.
  - El stock se descuenta al CREAR y se reintegra al CANCELAR/EDITAR.
  - Las elecciones de un grupo deben sumar EXACTO N (400 si no).
"""


def _crear_pedido(cliente, items, **extras):
    """POST público /api/pedidos. extras pisa campos del body (tipo_entrega,
    metodo_pago, etc.)."""
    datos = {"cliente_nombre": "Cliente test", "items": items}
    datos.update(extras)
    return cliente.post("/api/pedidos", json=datos)


def _stock(cliente, producto_id):
    """Stock actual del producto según el endpoint público de detalle."""
    return cliente.get(f"/api/productos/{producto_id}").json()["stock"]


def test_crear_pedido_snapshot_y_descuento(cliente, crear_producto):
    p = crear_producto(precio=1000, stock=10)
    resp = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 2}])
    assert resp.status_code == 201
    cuerpo = resp.json()
    assert cuerpo["estado"] == "pendiente"
    # El precio lo decide el BACKEND (snapshot), no lo que mande el cliente.
    assert cuerpo["items"][0]["precio_unitario"] == 1000
    assert cuerpo["total"] == 2000
    assert _stock(cliente, p["id"]) == 8  # descontado al crear


def test_precio_de_oferta_se_aplica_al_snapshot(cliente, admin_headers, crear_producto):
    p = crear_producto(precio=1000, stock=5)
    cliente.patch(
        f"/api/productos/{p['id']}/oferta",
        json={"en_oferta": True, "precio_oferta": 800},
        headers=admin_headers,
    )
    resp = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 1}])
    assert resp.json()["items"][0]["precio_unitario"] == 800


def test_pedido_mas_stock_del_disponible_409(cliente, crear_producto):
    p = crear_producto(stock=10)
    resp = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 11}])
    assert resp.status_code == 409
    # El stock quedó intacto: la validación corre ANTES de mover nada.
    assert _stock(cliente, p["id"]) == 10


def test_pedido_combo_descuenta_las_elecciones(cliente, combo_armado):
    c = combo_armado
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": c["combo"]["id"],
                "cantidad": 1,
                "elecciones": [
                    {"grupo": "Empanada", "producto_id": c["carne"], "cantidad": 3},
                    {"grupo": "Empanada", "producto_id": c["queso"], "cantidad": 3},
                    {"grupo": "Bebida", "producto_id": c["coca"], "cantidad": 1},
                ],
            }
        ],
    )
    assert resp.status_code == 201, resp.text
    # El total es el PRECIO del combo (el de las opciones es descriptivo).
    assert resp.json()["total"] == c["combo"]["precio"]
    # Se descuenta lo elegido (3 Carne + 3 Queso), no 6 de cada una.
    assert _stock(cliente, c["carne"]) == 27
    assert _stock(cliente, c["queso"]) == 7
    assert _stock(cliente, c["coca"]) == 4
    assert _stock(cliente, c["agua"]) == 20  # no elegida: intacta
    assert _stock(cliente, c["postre"]) == 3  # el fijo siempre entra


def test_elecciones_que_no_suman_el_grupo_400(cliente, combo_armado):
    c = combo_armado
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": c["combo"]["id"],
                "cantidad": 1,
                # El grupo Empanada tiene 6 lugares y solo se eligen 3.
                "elecciones": [
                    {"grupo": "Empanada", "producto_id": c["carne"], "cantidad": 3},
                    {"grupo": "Bebida", "producto_id": c["coca"], "cantidad": 1},
                ],
            }
        ],
    )
    assert resp.status_code == 400


def test_eleccion_de_producto_que_no_es_opcion_400(cliente, combo_armado):
    c = combo_armado
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": c["combo"]["id"],
                "cantidad": 1,
                # El postre es componente FIJO, no opción del grupo Empanada.
                "elecciones": [
                    {"grupo": "Empanada", "producto_id": c["postre"], "cantidad": 6},
                    {"grupo": "Bebida", "producto_id": c["coca"], "cantidad": 1},
                ],
            }
        ],
    )
    assert resp.status_code == 400


def test_producto_simple_rechaza_elecciones(cliente, crear_producto):
    p = crear_producto()
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": p["id"],
                "cantidad": 1,
                "elecciones": [
                    {"grupo": "Inexistente", "producto_id": p["id"], "cantidad": 1}
                ],
            }
        ],
    )
    assert resp.status_code == 400


def test_delivery_sin_direccion_400(cliente, crear_producto):
    p = crear_producto()
    resp = _crear_pedido(
        cliente, [{"producto_id": p["id"], "cantidad": 1}], tipo_entrega="delivery"
    )
    assert resp.status_code == 400


def test_metodo_pago_invalido_400(cliente, crear_producto):
    p = crear_producto()
    resp = _crear_pedido(
        cliente, [{"producto_id": p["id"], "cantidad": 1}], metodo_pago="dolares"
    )
    assert resp.status_code == 400


def test_cancelar_reintegra_el_stock(cliente, admin_headers, crear_producto):
    p = crear_producto(stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 4}]).json()
    assert _stock(cliente, p["id"]) == 6
    resp = cliente.patch(
        f"/api/admin/pedidos/{pedido['id']}/cancelar", headers=admin_headers
    )
    assert resp.status_code == 200
    assert resp.json()["estado"] == "cancelada"
    # Las unidades que no se vendieron vuelven a la venta.
    assert _stock(cliente, p["id"]) == 10


def test_confirmar_fija_estado(cliente, admin_headers, crear_producto):
    p = crear_producto(stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 1}]).json()
    resp = cliente.patch(
        f"/api/admin/pedidos/{pedido['id']}/confirmar", headers=admin_headers
    )
    assert resp.json()["estado"] == "confirmada"
    # Confirmado ya no se puede tocar: 400 controlado (no 500 ni silencio).
    resp = cliente.patch(
        f"/api/admin/pedidos/{pedido['id']}/cancelar", headers=admin_headers
    )
    assert resp.status_code == 400


def test_editar_items_recalcula_total_y_diferencia_de_stock(
    cliente, admin_headers, crear_producto
):
    p = crear_producto(precio=1000, stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 4}]).json()
    assert _stock(cliente, p["id"]) == 6
    # El dueño ajusta el pedido por WhatsApp: ahora son 2 en vez de 4.
    resp = cliente.put(
        f"/api/admin/pedidos/{pedido['id']}",
        json={"items": [{"producto_id": p["id"], "cantidad": 2}]},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 2000
    # Reintegró los 4 viejos y volvió a descontar los 2 nuevos: queda 8.
    assert _stock(cliente, p["id"]) == 8
```

- [ ] **Step 2: Correr los tests nuevos**

Run: `cd backend && venv/Scripts/python.exe -m pytest tests/test_pedidos.py -v`
Expected: `11 passed`.

- [ ] **Step 3: Correr la suite completa**

Run: `cd backend && venv/Scripts/python.exe -m pytest -v`
Expected: `27 passed` (2 salud + 10 galería + 4 combos + 11 pedidos).

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_pedidos.py
git commit -m "test: ciclo de vida de pedidos - snapshot, stock, elecciones, reintegro

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Documentar cómo correr los tests

**Files:**
- Modify: `ESTADO-PROYECTO.md` (sección "Cómo correrlo local (VS Code)")

**Interfaces:**
- Consumes: nada de código.
- Produces: documentación del comando de tests para la entrega.

- [ ] **Step 1: Agregar la sección de tests a `ESTADO-PROYECTO.md`**

Después del bloque "Navegador" de la sección "Cómo correrlo local (VS Code)", agregar:

```markdown
---

## Tests del backend

```powershell
cd backend
.\venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt   # primera vez
.\venv\Scripts\python.exe -m pytest -v
```

La suite corre contra una **base SQLite en memoria** (aislada por test) y
escribe imágenes en un **directorio temporal**: nunca toca la base de
desarrollo ni `backend/uploads/`. Cubre: galería de imágenes, stock efectivo
de combos y ciclo de vida de pedidos. Diseño:
`docs/superpowers/specs/2026-09-24-backend-tests-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add ESTADO-PROYECTO.md
git commit -m "docs: como correr los tests del backend

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Hallazgo pendiente (NO parte de este plan)

Al leer `_construir_items` para este plan se detectó que `POST /api/pedidos`
(es **público**) acepta items **sin** `producto_id` con `nombre` +
`precio_unitario` elegidos por quien llama (diseñado para el rol admin en el
editor, pero sin check de rol). Un cliente podría inyectar un ítem "Otro"
de precio 0. El plan NO lo arregla (cambiar producto va en otro ciclo de
diseño); este párrafo queda como registro del hallazgo para decidirlo con
el dueño del proyecto al terminar la suite.