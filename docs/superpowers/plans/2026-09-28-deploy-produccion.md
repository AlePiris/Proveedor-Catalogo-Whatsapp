# Deploy a producción (Blob + credenciales + modales) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar la web lista para producción en Vercel + Neon + Blob: imágenes en Blob, credenciales del dueño sin hardcodeo (cambio y recuperación de contraseña), modales propios y artefactos de deploy.

**Architecture:** Un helper único de archivos (`app/archivos.py`) decide por entorno — sin `BLOB_READ_WRITE_TOKEN` escribe a disco como hoy (dev y los 31 tests no cambian), con token sube al CDN de Vercel Blob vía el SDK oficial de Python y devuelve una URL absoluta que el resto del código ya consume tal cual. Las credenciales viven en endpoints de `/api/auth` (cambio logueado + recuperación por email con token hasheado). El frontend reemplaza los `confirm()`/`prompt()` nativos por `components/Modal.tsx`.

**Tech Stack:** FastAPI + SQLAlchemy + pytest (backend); React + Vite + TS + Tailwind (frontend); `vercel` (SDK oficial Python de Blob, v0.11.4, MIT — ver nota abajo); smtplib (emails).

**Spec:** `docs/superpowers/specs/2026-09-27-deploy-produccion-design.md`

> **DECISIÓN DEL PLAN (requiere visto bueno del socio, ver mensaje de handoff):**
> la spec dice "HTTP directo a la API REST de Blob (verificada, sin SDK de Node)".
> El plan usa en cambio el **SDK oficial de Python** (`pip install vercel`, paquete
> oficial de Vercel, MIT, v0.11.4 de 2026-09-23): `BlobClient.put(pathname, bytes,
> access="public", content_type=...)` devuelve `.url`, `BlobClient.delete(url)`
> acepta la URL tal como la guardamos, y el token se lee solo de
> `BLOB_READ_WRITE_TOKEN` — exactamente el switch por entorno de la spec. El REST
> crudo es UNOFICIAL e inestable (su header `x-api-version` cambió de 7 a 12);
> el SDK de Node era la única opción cuando se escribió la spec, y este SDK de
> Python honra su intención con menos riesgo. El helper aísla la decisión: si el
> SDK decepciona, se cambia UN archivo (`app/archivos.py`).

## Global Constraints

- Comandos backend desde `backend/`: `./venv/Scripts/python.exe -m pytest -v` (Windows; el plan escribe `venv/Scripts/...`, si tu venv se llama `.venv` ajustá la ruta).
- NUNCA tocar la base de desarrollo (`backend/pizzeria.db`) ni `backend/uploads/` real desde los tests: las fixtures existentes (`engine`, `uploads_dir`, `cliente`) ya aíslan; los tests de seed pisonean `app.seed.SessionLocal` por la misma razón.
- Los comentarios del código son en español, estilo didáctico (explican el POR QUÉ), como el resto del códigobase.
- Única dependencia nueva: `vercel` en `backend/requirements.txt`. Nada más (smtplib es stdlib).
- Verificación frontend en cada tarea que lo toca: `npm run build` (corre `tsc`) verde desde `frontend/`.
- Pydantic v2 serializa Decimal como STRING; los asserts monetarios comparan con `Decimal(...)`. (No aplica a tareas nuevas, pero gobierna ediciones en archivos existentes.)
- Mensajes de error de API en español, con `detail` claro (patrón existente).
- Fin de cada commit: `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Los endpoints de recuperación responden genérico: NUNCA confirman si existe una cuenta (spec 4c).
- Toda contraseña nueva: longitud mínima 8 (Pydantic `Field(min_length=8)` → 422).

## Review Focus

Inputs que la spec implica pero ningún caso obvio ejercita — cada línea tiene su test en el task dueño:

1. SMTP caído al pedir recuperación → el dueño debe ver un 500 honesto ("no pudimos enviar"), NO un falso "revisá tu email". Test: `test_recuperar_smtp_roto_500` (Task 4).
2. Token de restablecimiento usado por SEGUNDA vez → 400 y la password queda como la dejó el primer uso (no se cambia dos veces). Test: `test_restablecer_token_usado_segunda_vez_400` (Task 4).
3. Seed sin `ADMIN_USERNAME`/`ADMIN_PASSWORD` → error claro ANTES de abrir la sesión de DB (no crea categorías a medias). Test: `test_seed_sin_vars_termina_sin_tocar_db` (Task 2).
4. Blob `put()` falla (token inválido, store caído) → 500 y NO queda fila de imagen con URL rota. Test: `test_subir_con_blob_roto_no_deja_fila` (Task 1).
5. Cambio de contraseña con la actual incorrecta → 400 y el hash queda INTACTO (el login viejo sigue andando). Test: `test_cambiar_password_actual_incorrecta_400` (Task 3).
6. Imagen > 4.5MB (límite de body de Vercel) → rechazo claro ANTES de viajar. Backend: `test_subir_imagen_muy_grande_400` (Task 7, baja el límite de 5MB a 4.5MB); frontend: check en `uploadImagen` (Task 7, verificado con build + manual — el frontend no tiene runner de tests).

---

### Task 1: Helper de archivos (disco ↔ Vercel Blob)

**Files:**
- Create: `backend/app/archivos.py`
- Modify: `backend/app/config.py` (agregar 1 campo)
- Modify: `backend/app/routers/productos.py:249-255, 293-308, 333-339`
- Modify: `backend/tests/conftest.py` (fixture `uploads_dir`: cambia el target del monkeypatch)
- Test: `backend/tests/test_archivos.py`
- Modify: `backend/requirements.txt` (agregar `vercel`)

**Interfaces:**
- Consumes: `settings` (config), el global `UPLOAD_DIR` (hoy en `app/routers/productos.py:67` — se MUDA a `app/archivos.py`; `productos.py` deja de tenerlo).
- Produces (firmas exactas, Tasks 2-7 y el resto del código confían en esto):
  - `guardar_archivo(nombre: str, contenido: bytes, content_type: str | None = None) -> str` — devuelve la URL a guardar en `producto_imagenes.url` / `imagen_url`.
  - `borrar_archivo(url: str) -> None` — borra el archivo/blob backing de esa URL; tolera que ya no exista.
  - `UPLOAD_DIR` vive en `app/archivos.py` (la fixture `uploads_dir` lo monkeypatchea ahí).
  - `settings.blob_read_write_token: str = ""` en `config.py`.

- [ ] **Step 1: Crear `backend/requirements.txt` con `vercel` (al final, con comentario didáctico)**

```
# SDK oficial de Python para Vercel Blob (subida de imágenes en producción).
# Solo se usa si BLOB_READ_WRITE_TOKEN está presente; sin el token la app
# escribe a disco como siempre y este paquete no se toca (import lazy).
vercel
```

Instalar en el venv de test: `./venv/Scripts/python.exe -m pip install -r requirements.txt`

- [ ] **Step 2: Agregar el campo a `config.py`** (después de `cors_origins`, antes de la property)

```python
    # Token del Blob store de Vercel (lo genera Vercel al vincular el store).
    # VACÍO en dev/tests: la app escribe imágenes a disco como siempre.
    # PRESENTE en prod: guardar_archivo() sube a Blob y devuelve URL absoluta.
    blob_read_write_token: str = ""
```

- [ ] **Step 3: Escribir los tests FALLANDO — `backend/tests/test_archivos.py`** (archivo nuevo, completo)

```python
"""
Tests del helper de archivos: disco (sin token) vs Vercel Blob (con token).

Regla que fijan (spec sección 3): guardar_archivo/borrar_archivo son la ÚNICA
via de E/S de imágenes. Sin BLOB_READ_WRITE_TOKEN escriben a disco y devuelven
"/uploads/<nombre>" (comportamiento de siempre); con token suben al CDN de
Blob y devuelven una URL ABSOLUTA. El resto del código ya consume la URL tal
cual, por eso nada más cambia.
"""
from types import SimpleNamespace

import pytest

from app.archivos import UPLOAD_DIR, borrar_archivo, guardar_archivo


# BlobClient falso: registra las llamadas SIN tocar red ni disco.
class FakeBlobClient:
    uploads: list = []
    deletes: list = []

    def __init__(self, token=None):
        self.token = token

    def put(self, pathname, body, *, access, content_type=None, add_random_suffix=False):
        FakeBlobClient.uploads.append(
            {"token": self.token, "pathname": pathname, "body": body,
             "access": access, "content_type": content_type}
        )
        return SimpleNamespace(url=f"https://fake.blob.vercel-storage.com/{pathname}")

    def delete(self, url):
        FakeBlobClient.deletes.append(url)


def test_guardar_sin_token_escribe_a_disco(uploads_dir):
    url = guardar_archivo("7_abc.jpg", b"datos", content_type="image/jpeg")
    assert url == "/uploads/7_abc.jpg"
    assert (uploads_dir / "7_abc.jpg").read_bytes() == b"datos"


def test_borrar_url_relativa_elimina_el_archivo(uploads_dir):
    guardar_archivo("7_abc.jpg", b"datos")
    borrar_archivo("/uploads/7_abc.jpg")
    assert not (uploads_dir / "7_abc.jpg").exists()


def test_guardar_con_token_sube_a_blob_y_no_toca_disco(uploads_dir, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "blob_read_write_token", "token-fake")
    monkeypatch.setattr("vercel.blob.BlobClient", FakeBlobClient)
    FakeBlobClient.uploads.clear()
    url = guardar_archivo("7_abc.jpg", b"datos", content_type="image/jpeg")
    # URL ABSOLUTA del CDN, no la relativa de disco.
    assert url == "https://fake.blob.vercel-storage.com/7_abc.jpg"
    # Subió con el token y access público; no escribió NADA a disco.
    assert FakeBlobClient.uploads == [{
        "token": "token-fake", "pathname": "7_abc.jpg", "body": b"datos",
        "access": "public", "content_type": "image/jpeg",
    }]
    assert list(uploads_dir.iterdir()) == []


def test_borrar_url_absoluta_borra_del_blob(uploads_dir, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "blob_read_write_token", "token-fake")
    monkeypatch.setattr("vercel.blob.BlobClient", FakeBlobClient)
    FakeBlobClient.deletes.clear()
    borrar_archivo("https://fake.blob.vercel-storage.com/7_abc.jpg")
    # Borra del Blob por la URL tal como la guardamos.
    assert FakeBlobClient.deletes == ["https://fake.blob.vercel-storage.com/7_abc.jpg"]


def test_subir_con_blob_roto_no_deja_fila(
    cliente, admin_headers, crear_producto, uploads_dir, monkeypatch
):
    """Si el CDN rechaza la subida (token malo, store caído), el endpoint debe
    fallar con 500 y NO guardar una fila con una URL rota."""
    from app.config import settings
    monkeypatch.setattr(settings, "blob_read_write_token", "token-fake")

    class BlobRoto:
        def __init__(self, token=None): ...
        def put(self, *a, **kw):
            raise RuntimeError("store caído")

    monkeypatch.setattr("vercel.blob.BlobClient", BlobRoto)
    p = crear_producto()
    resp = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("foto.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, "image/png")},
        headers=admin_headers,
    )
    assert resp.status_code == 500
    # La galería quedó vacía: sin fila, sin imagen_url, sin archivo en disco.
    detalle = cliente.get(f"/api/productos/{p['id']}").json()
    assert detalle["imagenes"] == []
    assert detalle["imagen_url"] is None
    assert list(uploads_dir.iterdir()) == []
```

- [ ] **Step 4: Correrlos y verlos fallar**

Run: `./venv/Scripts/python.exe -m pytest tests/test_archivos.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.archivos'`

- [ ] **Step 5: Implementar `backend/app/archivos.py`** (archivo nuevo, completo)

```python
"""
Helper de E/S de imágenes: la ÚNICA vía por donde entran y salen archivos.

Switch por entorno (spec, sección 3):
  - Sin BLOB_READ_WRITE_TOKEN (dev y tests): escribe a disco en UPLOAD_DIR y
    devuelve la URL RELATIVA "/uploads/<nombre>" — exactamente como siempre,
    por eso los 31 tests y el proxy de Vite siguen funcionando igual.
  - Con token (prod, Vercel serverless): el disco no persiste entre
    invocaciones, así que sube al CDN de Vercel Blob (SDK oficial de Python)
    y devuelve la URL ABSOLUTA del blob. El resto del código ya guarda y
    sirve la URL tal cual, así que NADA más cambia.

El import de vercel.blob es LAZY (dentro de las ramas con token): en dev el
paquete ni se importa, y si faltara instalado no rompe nada local.
"""
import os

from app.config import settings

# OJO con la profundidad de dirname: __file__ es app/archivos.py, así que
# 3 dirname suben hasta backend/ y uploads queda en backend/uploads (la
# ruta que sirve StaticFiles en main.py — bug ya pisoteado antes, ver
# ESTADO-PROYECTO, "Bugs ya fixeados" #3).
UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "uploads",
)


def guardar_archivo(nombre: str, contenido: bytes, content_type: str | None = None) -> str:
    """Persiste el archivo y devuelve la URL a guardar en la DB."""
    if settings.blob_read_write_token:
        from vercel.blob import BlobClient

        resultado = BlobClient(token=settings.blob_read_write_token).put(
            nombre,
            contenido,
            access="public",           # las fotos del catálogo son públicas
            content_type=content_type,
            add_random_suffix=False,  # el nombre ya trae uuid propio
        )
        return resultado.url

    # Disco local (dev): comportamiento histórico, byte a byte.
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, nombre), "wb") as f:
        f.write(contenido)
    return f"/uploads/{nombre}"


def borrar_archivo(url: str) -> None:
    """Borra lo que backing tenga esa URL. Tolerante: si ya no existe, no
    rompe (mismo criterio que tenía el try/except de productos.py)."""
    if url.startswith("http"):
        # URL absoluta = blob del CDN. Solo tiene sentido con token presente;
        # sin token no hay CDN que limpiar (URLs absolutas no deberían existir).
        if settings.blob_read_write_token:
            from vercel.blob import BlobClient

            BlobClient(token=settings.blob_read_write_token).delete(url)
        return
    # URL relativa "/uploads/<archivo>": archivo local.
    try:
        os.remove(os.path.join(UPLOAD_DIR, url.rsplit("/", 1)[-1]))
    except OSError:
        pass
```

- [ ] **Step 6: Mover el monkeypatch de la fixture (`conftest.py`)**

En `backend/tests/conftest.py`, la fixture `uploads_dir` apunta hoy a
`"app.routers.productos.UPLOAD_DIR"`. Como el global se mudó, cambiar SOLO esa línea por:

```python
    monkeypatch.setattr("app.archivos.UPLOAD_DIR", str(carpeta))
```

(y actualizar la primera línea de su docstring para que diga "directorio temporal de uploads: app/archivos.py escribe y borra acá").

- [ ] **Step 7: Rewiring de `productos.py`** — tres puntos exactos:

a) Imports (arriba del archivo): agregar
```python
from app.archivos import borrar_archivo, guardar_archivo
```
y BORRAR la definición de `UPLOAD_DIR` (líneas 61-67 con su comentario) — se muda completa a `archivos.py`. Quitar `import glob` si deja de usarse.

b) `subir_imagen`: reemplazar el bloque de escritura (líneas 297-304)

```python
    # Persiste el archivo (disco en dev / Blob en prod) y guarda la URL que
    # devuelva: relativa o absoluta, el resto del código la consume tal cual.
    url = guardar_archivo(nombre, datos, content_type=archivo.content_type)
```
(el `es_primera = ...` y lo que sigue quedan igual: ya usaban `url`)

c) `borrar_imagen`: reemplazar el bloque del archivo físico (líneas 333-339)

```python
    # El archivo/blob backing de esa URL (disco o Blob, según entorno). Si ya
    # no existe, borrar_archivo lo tolera sin romper.
    borrar_archivo(imagen.url)
```

d) `borrar_producto`: reemplazar el glob de huérfanos (líneas 249-255)

```python
    # Limpia los ARCHIVOS backing de la galería (disco o Blob, según entorno):
    # si no, quedan huérfanos. Las filas van por cascade.
    for imagen in producto.imagenes:
        borrar_archivo(imagen.url)
    # Fallback histórico: producto cuya foto SOLO existe en imagen_url sin
    # fila en la galería (datos viejos sin backfill).
    if producto.imagen_url and all(imagen.url != producto.imagen_url for imagen in producto.imagenes):
        borrar_archivo(producto.imagen_url)
```

- [ ] **Step 8: Correr TODA la suite**

Run: `./venv/Scripts/python.exe -m pytest -v`
Expected: 36 passed (31 existentes + 5 nuevos; los de galería siguen verdes porque el path de disco no cambió)

- [ ] **Step 9: Commit**

```bash
git add backend/app/archivos.py backend/app/config.py backend/app/routers/productos.py backend/tests/conftest.py backend/tests/test_archivos.py backend/requirements.txt
git commit -m "feat: helper de archivos con switch disco/blob (vercel sdk)"
```

---

### Task 2: Seed sin hardcodeo + `.env.example` + docker-compose

**Files:**
- Modify: `backend/app/config.py` (2 campos más)
- Modify: `backend/app/seed.py:56-68` (main)
- Create: `backend/.env.example`
- Modify: `docker-compose.yml` (env del servicio backend)
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Consumes: `settings.admin_username`, `settings.admin_password` (este task los crea en config); `app.seed.SessionLocal` (pisoneable en tests).
- Produces: `seed.main()` exige `ADMIN_USERNAME` y `ADMIN_PASSWORD` en el entorno ANTES de abrir la DB; crea el AdminUser con esos valores; idempotente como hoy.

- [ ] **Step 1: Config — campos del admin (en `config.py`, después de `blob_read_write_token`)**

```python
    # Credenciales INICIALES del dueño (las consume SOLO el seed; en prod el
    # dueño luego las cambia desde Ajustes). REQUERIDAS para correr el seed:
    # si falta alguna, seed.py termina con error ANTES de tocar la DB.
    admin_username: str = ""
    admin_password: str = ""
```

- [ ] **Step 2: Tests FALLANDO — `backend/tests/test_seed.py`** (archivo nuevo, completo)

```python
"""
Tests del seed: credenciales del dueño desde ENV VARS, nunca hardcodeadas.

Regla (spec 4a): ADMIN_USERNAME y ADMIN_PASSWORD son REQUERIDAS. Si falta
alguna, el seed termina con mensaje claro ANTES de abrir la sesión de DB
(no crea categorías a medias). La unicidad del username la garantiza la DB
(unique=True), el código no la verifica. Idempotente como siempre.

OJO: seed.main() usa SessionLocal (la DB de verdad) — los tests lo pisonean
con una sessionmaker del engine de test, la base de desarrollo NO se toca.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

import app.seed
from app.auth import verify_password
from app.config import settings
from app.models import AdminUser, Base


@pytest.fixture()
def db_de_test(engine, cliente):
    """SessionMaker apuntando al engine de test (esquema ya creado por la
    fixture cliente). Lo usamos para pisonear app.seed.SessionLocal."""
    Base.metadata.create_all(bind=engine)  # por si el test corre solo
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def test_seed_sin_vars_termina_sin_tocar_db(monkeypatch, capsys):
    """Sin ADMIN_USERNAME/ADMIN_PASSWORD: SystemExit con mensaje claro, y la
    sesión de DB ni se abre (el pisoneo revienta si seed la crea igual)."""
    def sessionlocal_prohibida():
        raise AssertionError("el seed NO debe abrir la DB sin las ADMIN_*")

    monkeypatch.setattr(app.seed, "SessionLocal", sessionlocal_prohibida)
    monkeypatch.setattr(settings, "admin_username", "")
    monkeypatch.setattr(settings, "admin_password", "")

    with pytest.raises(SystemExit):
        app.seed.main()

    salida = capsys.readouterr().out
    assert "ADMIN_USERNAME" in salida or "ADMIN_PASSWORD" in salida


def test_seed_crea_admin_de_env_vars(db_de_test, monkeypatch):
    monkeypatch.setattr(app.seed, "SessionLocal", db_de_test)
    monkeypatch.setattr(settings, "admin_username", "duenio")
    monkeypatch.setattr(settings, "admin_password", "un-secreto-largo")

    app.seed.main()

    db = db_de_test()
    admin = db.query(AdminUser).filter(AdminUser.username == "duenio").first()
    assert admin is not None
    # Se guarda el HASH, nunca la password en claro.
    assert verify_password("un-secreto-largo", admin.password_hash)
    db.close()


def test_seed_es_idempotente_no_duplica_ni_pisa(db_de_test, monkeypatch):
    monkeypatch.setattr(app.seed, "SessionLocal", db_de_test)
    monkeypatch.setattr(settings, "admin_username", "duenio")
    monkeypatch.setattr(settings, "admin_password", "primer-secreto")

    app.seed.main()
    # Segunda corrida (simula un re-deploy del init): no duplica NI cambia
    # la password existente — la del dueño ya puede ser la suya propia.
    monkeypatch.setattr(settings, "admin_password", "otra-cosa")
    app.seed.main()

    db = db_de_test()
    assert db.query(AdminUser).count() == 1
    admin = db.query(AdminUser).filter(AdminUser.username == "duenio").first()
    assert verify_password("primer-secreto", admin.password_hash)
    assert not verify_password("otra-cosa", admin.password_hash)
    db.close()
```

- [ ] **Step 3: Verlos fallar**

Run: `./venv/Scripts/python.exe -m pytest tests/test_seed.py -v`
Expected: FAIL — `test_seed_sin_vars...` falla porque el seed actual corre sin vars (crea "admin"); los otros fallan comparando username "duenio" contra "admin".

- [ ] **Step 4: Implementar el cambio en `seed.py`** — reemplazar `main()` (líneas 56-68) por:

```python
def main():
    # Credenciales desde ENV VARS, REQUERIDAS. Se valida ANTES de abrir la DB:
    # si falta algo, mejor no crear categorías/config a medias (la próxima
    # corrida con las vars ya puestas termina todo). La unicidad del username
    # la garantiza la DB (unique=True en models.py), no este código.
    if not settings.admin_username or not settings.admin_password:
        print(
            "Falta ADMIN_USERNAME o ADMIN_PASSWORD en el entorno (ej. backend/.env "
            "en dev, variables del proyecto Vercel en prod). Definilas y volvé a correr."
        )
        raise SystemExit(1)

    db = SessionLocal()
    try:
        # Admin: solo si no existe ya. Si existe, no lo toca (el dueño pudo
        # haber cambiado su password desde Ajustes; el seed nunca la pisa).
        if db.query(AdminUser).filter(AdminUser.username == settings.admin_username).first() is None:
            db.add(AdminUser(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                nombre="Dueño",
            ))
            print(f"Admin creado: {settings.admin_username} (la password NO se imprime).")
        else:
            print(f"El admin '{settings.admin_username}' ya existe (no se recrea ni se modifica).")
```

(y agregar arriba `from app.config import settings` — el resto de main() queda igual). También actualizar el docstring del módulo (líneas 1-10): borrar "El admin arranca con admin / admin123" y poner "El admin se crea con ADMIN_USERNAME/ADMIN_PASSWORD del entorno (requeridas)."

- [ ] **Step 5: Crear `backend/.env.example`** (archivo nuevo, completo — placeholders, nunca secretos reales)

```
# Copiá este archivo como .env y completá los valores. .env NO está en git.

# DB: Postgres local (docker-compose), o la cadena POOLED de Neon en prod.
DATABASE_URL=postgresql+psycopg2://pizzeria:pizzeria@localhost:5432/pizzeria

# Secreto para firmar los JWT del login. Largo y aleatorio:
#   python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET=cambiar-por-algo-largo-y-aleatorio

# Orígenes del frontend permitidos (CORS), separados por coma.
CORS_ORIGINS=http://localhost:5173

# Credenciales INICIALES del dueño (REQUERIDAS para correr el seed; después
# él las cambia desde Ajustes → Cambiar contraseña).
ADMIN_USERNAME=duenio
ADMIN_PASSWORD=cambiar-antes-del-seed

# Token del Blob store de Vercel (solo prod; vacío = escribir a disco local).
BLOB_READ_WRITE_TOKEN=

# Recuperación de contraseña (solo prod; ver spec sección 4).
FRONTEND_URL=http://localhost:5173
RECOVERY_EMAILS=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
```

- [ ] **Step 6: docker-compose — agregar al `environment:` del servicio `backend`**

```yaml
      # Credenciales iniciales del dueño para el seed (el comando del
      # contenedor corre init_db + seed al arrancar; ver Dockerfile).
      ADMIN_USERNAME: duenio
      ADMIN_PASSWORD: cambiar-antes-del-seed
```

- [ ] **Step 7: Suite completa**

Run: `./venv/Scripts/python.exe -m pytest -v`
Expected: 39 passed (36 + 3 nuevos)

- [ ] **Step 8: Commit**

```bash
git add backend/app/config.py backend/app/seed.py backend/.env.example backend/tests/test_seed.py docker-compose.yml
git commit -m "feat: seed lee credenciales iniciales de env vars (sin hardcodeo)"
```

---

### Task 3: Cambio de contraseña (backend + form en Ajustes)

**Files:**
- Modify: `backend/app/schemas.py` (clase PasswordChange)
- Modify: `backend/app/routers/auth.py` (endpoint PUT /password)
- Test: `backend/tests/test_auth.py`
- Modify: `frontend/src/api/client.ts` (método cambiarPassword)
- Modify: `frontend/src/pages/admin/Ajustes.tsx` (form "Cambiar contraseña")

**Interfaces:**
- Consumes: `require_admin` (= `get_admin_actual`, devuelve el `AdminUser` ORM), `verify_password`, `hash_password` (todos en `app/auth.py`).
- Produces: `PUT /api/auth/password` — body `{"password_actual": str, "password_nueva": str}` (mín 8), con token admin; 400 si la actual no coincide; 422 si la nueva es corta. Frontend: `api.admin.cambiarPassword({password_actual, password_nueva})`.

- [ ] **Step 1: Tests FALLANDO — `backend/tests/test_auth.py`** (archivo nuevo, completo)

```python
"""
Tests del cambio de contraseña (spec 4b): el dueño logueado cambia su
password; exige la ACTUAL (nadie cambia la de otro con un token robado sin
saberla) y la nueva tiene mínimo 8. El login queda cubierto por el flujo.
"""


def _login(cliente, username, password):
    return cliente.post("/api/auth/login", json={"username": username, "password": password})


def test_cambiar_password_correcta_habilita_la_nueva(cliente, admin_headers):
    resp = cliente.put(
        "/api/auth/password",
        json={"password_actual": "secreto123", "password_nueva": "nueva-clave-456"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    # La vieja deja de andar, la nueva entra.
    assert _login(cliente, "tester", "secreto123").status_code == 401
    assert _login(cliente, "tester", "nueva-clave-456").status_code == 200


def test_cambiar_password_actual_incorrecta_400(cliente, admin_headers):
    resp = cliente.put(
        "/api/auth/password",
        json={"password_actual": "no-es-esta", "password_nueva": "nueva-clave-456"},
        headers=admin_headers,
    )
    assert resp.status_code == 400
    # El hash quedó INTACTO: el login con la password de siempre sigue andando.
    assert _login(cliente, "tester", "secreto123").status_code == 200


def test_cambiar_password_corta_422(cliente, admin_headers):
    resp = cliente.put(
        "/api/auth/password",
        json={"password_actual": "secreto123", "password_nueva": "corta"},
        headers=admin_headers,
    )
    assert resp.status_code == 422
    assert _login(cliente, "tester", "secreto123").status_code == 200


def test_cambiar_password_sin_token_401(cliente):
    resp = cliente.put(
        "/api/auth/password",
        json={"password_actual": "x", "password_nueva": "nueva-clave-456"},
    )
    assert resp.status_code == 401
```

(Nota: la fixture `admin_headers` crea `tester` con password `secreto123`.)

- [ ] **Step 2: Verlos fallar**

Run: `./venv/Scripts/python.exe -m pytest tests/test_auth.py -v`
Expected: FAIL — 405/404, el endpoint no existe

- [ ] **Step 3: Schema — en `schemas.py`, junto a las clases de auth (cerca de LoginRequest):**

```python
class PasswordChange(BaseModel):
    """Cambio de contraseña del dueño logueado (spec 4b). Exige la actual:
    un token robado solo no alcanza para cambiar la password."""
    password_actual: str
    password_nueva: str = Field(min_length=8)
```

- [ ] **Step 4: Endpoint — en `routers/auth.py`:**

```python
from app.auth import crear_token, hash_password, verify_password
from app.schemas import LoginRequest, PasswordChange, Token


@router.put("/password")
def cambiar_password(
    datos: PasswordChange,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin),
):
    """El dueño cambia su contraseña logueado (spec 4b). require_admin ya
    resolvió el AdminUser desde el token; verificamos la actual con bcrypt
    antes de pisar el hash."""
    if not verify_password(datos.password_actual, admin.password_hash):
        raise HTTPException(
            status_code=400,
            detail="La contraseña actual no coincide",
        )
    admin.password_hash = hash_password(datos.password_nueva)
    db.commit()
    return {"ok": True}
```

(importar `require_admin` de `app.auth`, `hash_password` en el import de arriba; `require_admin = get_admin_actual` existe en auth.py:81).

- [ ] **Step 5: Suite backend**

Run: `./venv/Scripts/python.exe -m pytest tests/test_auth.py -v`
Expected: 4 passed. Luego suite completa → 43 passed.

- [ ] **Step 6: Frontend — método en `client.ts` (dentro de `admin:`):**

```ts
    cambiarPassword: (p: { password_actual: string; password_nueva: string }) =>
      request<{ ok: boolean }>("/auth/password", { method: "PUT", body: JSON.stringify(p) }, true),
```

- [ ] **Step 7: Form en `Ajustes.tsx`** — agregar estado al componente (junto a los demás useState):

```tsx
  const [pw, setPw] = useState({ actual: "", nueva: "", repetir: "" });
  const [pwOk, setPwOk] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  async function cambiarPassword() {
    setPwError(null);
    setPwOk(null);
    if (pw.nueva !== pw.repetir) {
      setPwError("La nueva contraseña y la repetición no coinciden.");
      return;
    }
    if (pw.nueva.length < 8) {
      setPwError("La nueva contraseña necesita al menos 8 caracteres.");
      return;
    }
    try {
      await api.admin.cambiarPassword({ password_actual: pw.actual, password_nueva: pw.nueva });
      setPw({ actual: "", nueva: "", repetir: "" });
      setPwOk("Contraseña cambiada ✓ (usala la próxima vez que entres).");
    } catch (e) {
      setPwError((e as Error).message || "No se pudo cambiar la contraseña.");
    }
  }
```

y al final del `<div>` contenedor principal (después del bloque de "Guardar ajustes", antes del cierre):

```tsx
      {/* Cambiar contraseña (spec 4b): el dueño pasa de la password inicial
          del seed a la suya propia sin que el dev toque la DB a mano. */}
      <div className="border-t border-negro-borde pt-4 space-y-3">
        <h3 className="font-bold text-gray-100">Cambiar contraseña</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="password"
            className={inputCls}
            placeholder="Contraseña actual"
            value={pw.actual}
            onChange={(e) => setPw((p) => ({ ...p, actual: e.target.value }))}
          />
          <input
            type="password"
            className={inputCls}
            placeholder="Contraseña nueva (mín. 8)"
            value={pw.nueva}
            onChange={(e) => setPw((p) => ({ ...p, nueva: e.target.value }))}
          />
          <input
            type="password"
            className={inputCls}
            placeholder="Repetir la nueva"
            value={pw.repetir}
            onChange={(e) => setPw((p) => ({ ...p, repetir: e.target.value }))}
          />
        </div>
        {pwError && <p className="text-marca text-sm">{pwError}</p>}
        {pwOk && <p className="text-green-400 text-sm">{pwOk}</p>}
        <div className="flex justify-end">
          <button
            onClick={cambiarPassword}
            className="border border-negro-borde text-gray-200 px-4 py-2 rounded-lg font-semibold hover:border-marca hover:text-marca transition"
          >
            Cambiar contraseña
          </button>
        </div>
      </div>
```

- [ ] **Step 8: Build frontend**

Run: `npm run build` (desde `frontend/`)
Expected: `✓ built in ...` sin errores de tsc

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/auth.py backend/tests/test_auth.py frontend/src/api/client.ts frontend/src/pages/admin/Ajustes.tsx
git commit -m "feat: cambio de contrasena del duenio logueado (backend + ajustes)"
```

---

### Task 4: Recuperación de contraseña — backend (emails, tabla, endpoints)

**Files:**
- Modify: `backend/app/config.py` (campos SMTP/recovery/frontend_url)
- Create: `backend/app/emails.py`
- Modify: `backend/app/models.py` (PasswordReset)
- Modify: `backend/app/schemas.py` (RestablecerRequest)
- Modify: `backend/app/routers/auth.py` (recuperar + restablecer)
- Test: `backend/tests/test_recuperacion.py`

**Interfaces:**
- Consumes: `admin_headers` (crea `tester`/`secreto123`), `hash_password`/`verify_password`, `settings`.
- Produces:
  - `enviar_email(asunto: str, cuerpo: str, destinatarios: list[str]) -> None` (levanta si SMTP no configurado o falla el envío).
  - `POST /api/auth/recuperar` (público, sin body) → 200 genérico; 429 tras 3 en un minuto; 500 si el envío falla.
  - `POST /api/auth/restablecer` (público) body `{"token": str, "password_nueva": str (mín 8)}` → 200 o 400/422.
  - Tabla `password_resets` (id, admin_id FK, token_hash unique, expira_en, usado, created_at).

- [ ] **Step 1: Config — campos nuevos (después de admin_password):**

```python
    # ---- Recuperación de contraseña (spec 4c/4d). Vacíos = deshabilitado
    # en dev: los tests mockean enviar_email y nunca mandan mails de verdad.
    frontend_url: str = ""      # arma el link .../restablecer-password?token=
    recovery_emails: str = ""   # destinatarios fijos, separados por coma

    @property
    def recovery_emails_list(self) -> list[str]:
        return [e.strip() for e in self.recovery_emails.split(",") if e.strip()]

    # SMTP para enviar el recovery. Gmail con app-password (2FA) o Brevo.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    email_from: str = ""
```

(la property va con las demás, al lado de `cors_origins_list`; pydantic-settings no la lee del .env por ser property — igual que la existente).

- [ ] **Step 2: Tests FALLANDO — `backend/tests/test_recuperacion.py`** (archivo nuevo, completo)

```python
"""
Tests de la recuperación de contraseña (spec 4c/4d).

Reglas que fijan:
  - El token viaja SOLO en el email; en la DB queda su SHA-256 (nunca en claro).
  - Expira a los 30 min y es de UN SOLO uso (segundo uso → 400, sin re-cambio).
  - POST /recuperar responde SIEMPRE genérico (no confirma si hay cuenta) y
    tiene rate limit best-effort (429 tras 3 en un minuto, por instancia).
  - Si el envío de email FALLA, 500 honesto (no un falso "revisá tu email").
  - enviar_email se MOCKEA: estos tests nunca hablan con un SMTP de verdad.
"""
import hashlib
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app import auth as auth_module
from app.models import Base, PasswordReset


class EmailFalso:
    """Registra los envíos en lugar de hablar con un SMTP."""
    enviados: list = []

    def __call__(self, asunto, cuerpo, destinatarios):
        EmailFalso.enviados.append({"asunto": asunto, "cuerpo": cuerpo, "para": destinatarios})


@pytest.fixture(autouse=True)
def email_mock(monkeypatch):
    EmailFalso.enviados = []
    monkeypatch.setattr("app.routers.auth.enviar_email", EmailFalso())
    # El rate limit vive en una lista de módulo: estado limpio por test.
    from app.routers import auth as router_auth
    router_auth._pedidos_recuperacion.clear()
    yield

```python
def _token_del_ultimo_email():
    """Extrae el token del link .../restablecer-password?token=<tok> del
    último email enviado (el cuerpo es texto plano, el link es la única URL)."""
    cuerpo = EmailFalso.enviados[-1]["cuerpo"]
    return cuerpo.split("token=")[1].split()[0]


def test_recuperar_genera_reset_y_envia_email(cliente, admin_headers, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "frontend_url", "https://front.test")
    monkeypatch.setattr(settings, "recovery_emails", "duenio@mail.com, dev@mail.com")

    resp = cliente.post("/api/auth/recuperar")
    assert resp.status_code == 200
    # Envió UN email a TODOS los destinatarios fijos, con el link armado.
    assert len(EmailFalso.enviados) == 1
    envio = EmailFalso.enviados[0]
    assert envio["para"] == ["duenio@mail.com", "dev@mail.com"]
    assert "https://front.test/restablecer-password?token=" in envio["cuerpo"]


def test_recuperar_guarda_el_hash_no_el_token(cliente, admin_headers):
    cliente.post("/api/auth/recuperar")
    token = _token_del_ultimo_email()
    resp = cliente.post(
        "/api/auth/restablecer",
        json={"token": token, "password_nueva": "nueva-clave-456"},
    )
    assert resp.status_code == 200
    # El token REAL funciona (el hash guardado era de este token, no otro).
    assert cliente.post("/api/auth/login", json={"username": "tester", "password": "nueva-clave-456"}).status_code == 200


def test_recuperar_responde_generico_sin_admin(cliente):
    """Sin ninguna cuenta creada: MISMO 200 genérico (no filtra existencia)."""
    resp = cliente.post("/api/auth/recuperar")
    assert resp.status_code == 200
    assert len(EmailFalso.enviados) == 0  # sin admins, no hay nada que mandar


def test_recuperar_rate_limit_429(cliente):
    for _ in range(3):
        assert cliente.post("/api/auth/recuperar").status_code == 200
    # 4º dentro del minuto: 429 (mejor ver un "esperá" a poder spampear mails).
    assert cliente.post("/api/auth/recuperar").status_code == 429


def test_recuperar_smtp_roto_500(cliente, admin_headers, monkeypatch):
    def email_roto(asunto, cuerpo, destinatarios):
        raise RuntimeError("SMTP caído")

    monkeypatch.setattr("app.routers.auth.enviar_email", email_roto)
    resp = cliente.post("/api/auth/recuperar")
    # 500 honesto: que el dueño sepa que el mail NO salió.
    assert resp.status_code == 500


def test_restablecer_token_usado_segunda_vez_400(cliente, admin_headers):
    cliente.post("/api/auth/recuperar")
    token = _token_del_ultimo_email()
    primera = cliente.post(
        "/api/auth/restablecer", json={"token": token, "password_nueva": "nueva-clave-456"}
    )
    assert primera.status_code == 200
    # SEGUNDA vuelta con el mismo token: 400, y la password no se toca de nuevo.
    segunda = cliente.post(
        "/api/auth/restablecer", json={"token": token, "password_nueva": "otra-clave-789"}
    )
    assert segunda.status_code == 400
    assert cliente.post("/api/auth/login", json={"username": "tester", "password": "nueva-clave-456"}).status_code == 200
    assert cliente.post("/api/auth/login", json={"username": "tester", "password": "otra-clave-789"}).status_code == 401


def test_restablecer_token_expirado_400(cliente, admin_headers, engine):
    """Se inserta a mano un reset VENCIDO contra el engine de test."""
    Sesion = sessionmaker(bind=engine)
    db = Sesion()
    db.add(PasswordReset(
        admin_id=1,
        token_hash=hashlib.sha256(b"tok-vencido").hexdigest(),
        expira_en=datetime.utcnow() - timedelta(minutes=1),
        usado=False,
    ))
    db.commit()
    db.close()
    resp = cliente.post(
        "/api/auth/restablecer", json={"token": "tok-vencido", "password_nueva": "nueva-clave-456"}
    )
    assert resp.status_code == 400


def test_restablecer_token_inexistente_400(cliente):
    resp = cliente.post(
        "/api/auth/restablecer", json={"token": "no-existe", "password_nueva": "nueva-clave-456"}
    )
    assert resp.status_code == 400


def test_restablecer_password_corta_422(cliente, admin_headers):
    cliente.post("/api/auth/recuperar")
    token = _token_del_ultimo_email()
    resp = cliente.post(
        "/api/auth/restablecer", json={"token": token, "password_nueva": "corta"}
    )
    assert resp.status_code == 422
```

(Nota: en `test_recuperar_guarda_el_hash_no_el_token` la línea `db = cliente.app...` es un noop que DEBE borrarse — quedó del borrador; el test no la necesita.)

- [ ] **Step 3: Verlos fallar**

Run: `./venv/Scripts/python.exe -m pytest tests/test_recuperacion.py -v`
Expected: FAIL — 404, los endpoints no existen

- [ ] **Step 4: `backend/app/emails.py`** (archivo nuevo, completo)

```python
"""
Envío de emails por SMTP (solo lo usa la recuperación de contraseña).

Configuración por las vars SMTP_*/EMAIL_FROM. Recomendado: Gmail con
app-password (2FA activado). Alternativa: Brevo free (300/día) cambiando
SMTP_HOST — el código es el mismo.

Los tests MOCKEAN este módulo (monkeypatch de app.routers.auth.enviar_email):
la suite nunca habla con un servidor de correo.
"""
import smtplib
from email.mime.text import MIMEText

from app.config import settings


def enviar_email(asunto: str, cuerpo: str, destinatarios: list[str]) -> None:
    """Envía un email de texto plano a todos los destinatarios.

    Levanta si SMTP no está configurado o el servidor rechaza el envío:
    preferimos un error VISIBLE a un email silenciosamente perdido.
    """
    if not destinatarios:
        return
    if not settings.smtp_host or not settings.smtp_user:
        raise RuntimeError("SMTP no configurado (falta SMTP_HOST/SMTP_USER en el entorno)")

    msg = MIMEText(cuerpo)
    msg["Subject"] = asunto
    msg["From"] = settings.email_from or settings.smtp_user
    msg["To"] = ", ".join(destinatarios)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        server.starttls()
        server.login(settings.smtp_user, settings.smtp_pass)
        server.send_message(msg)
```

- [ ] **Step 5: Modelo — en `models.py`, después de AdminUser:**

```python
class PasswordReset(Base):
    """Pedidos de recuperación de contraseña (spec 4c).

    Se guarda el SHA-256 del token, NUNCA el token en claro: si filtran la
    DB, los links ya enviados no sirven. Expira a los 30 min y es de un solo
    uso (usado=True marca que ya cambió la password con ese token).
    """
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admin_users.id"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False, index=True)
    expira_en = Column(DateTime, nullable=False)
    usado = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
```

(importar `ForeignKey` si models.py aún no lo tiene).

- [ ] **Step 6: Schema — en `schemas.py`:**

```python
class RestablecerRequest(BaseModel):
    """Uso del link de recuperación: el token llega por email (url ?token=)."""
    token: str
    password_nueva: str = Field(min_length=8)
```

- [ ] **Step 7: Endpoints — en `routers/auth.py`:**

```python
import hashlib
import secrets
import time
from datetime import datetime, timedelta

from app.emails import enviar_email
from app.config import settings
from app.models import AdminUser, PasswordReset
from app.schemas import LoginRequest, PasswordChange, RestablecerRequest, Token

# Rate limit best-effort en MEMORIA (spec 4c): máx 3 recuperaciones por minuto
# POR INSTANCIA. En serverless cada instancia tiene la suya — es una
# mitigación práctica, no una garantía. Aceptado por diseño.
_pedidos_recuperacion: list[float] = []


@router.post("/recuperar")
def recuperar(db: Session = Depends(get_db)):
    """Genera un link de restablecimiento y lo manda a los RECOVERY_EMAILS
    (fijos; no se pide email en el form para no confirmar qué cuentas hay).

    Responde SIEMPRE genérico (spec 4c): nunca confirma si existe una cuenta.
    Si el envío FALLA, 500 honesto — un falso 'revisá tu email' es peor.
    """
    ahora = time.monotonic()
    while _pedidos_recuperacion and ahora - _pedidos_recuperacion[0] > 60:
        _pedidos_recuperacion.pop(0)
    if len(_pedidos_recuperacion) >= 3:
        raise HTTPException(status_code=429, detail="Demasiados pedidos seguidos, esperá un minuto.")
    _pedidos_recuperacion.append(ahora)

    admins = db.query(AdminUser).all()
    if admins:
        # Un solo token para todos los admins (hoy existe uno; la tabla ya
        # soporta más sin cambiar el diseño).
        token = secrets.token_urlsafe(32)
        expiracion = datetime.utcnow() + timedelta(minutes=30)
        for admin in admins:
            db.add(PasswordReset(
                admin_id=admin.id,
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                expira_en=expiracion,
            ))
        db.commit()

        link = f"{settings.frontend_url}/restablecer-password?token={token}"
        cuerpo = (
            "Hola:\n\n"
            "Recibimos un pedido para restablecer la contraseña del panel.\n"
            "Abrí este link (vence en 30 minutos y sirve una sola vez):\n\n"
            f"{link}\n\n"
            "Si no fuiste vos, ignorá este email.\n"
        )
        enviar_email("Restablecer contraseña", cuerpo, settings.recovery_emails_list)

    return {"ok": True, "mensaje": "Si existe la cuenta, enviamos un link a los emails registrados."}


@router.post("/restablecer")
def restablecer(datos: RestablecerRequest, db: Session = Depends(get_db)):
    """Cambia la password con el token del email. Valida que exista, no esté
    usado ni vencido; lo marca usado y pisa el hash del admin."""
    token_hash = hashlib.sha256(datos.token.encode()).hexdigest()
    reset = db.query(PasswordReset).filter(PasswordReset.token_hash == token_hash).first()
    if reset is None or reset.usado or reset.expira_en < datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="El link es inválido o ya venció. Pedí uno nuevo.",
        )
    reset.usado = True
    admin = db.query(AdminUser).filter(AdminUser.id == reset.admin_id).first()
    admin.password_hash = hash_password(datos.password_nueva)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 8: Suite completa**

Run: `./venv/Scripts/python.exe -m pytest -v`
Expected: 52 passed (43 + 9 nuevos)

- [ ] **Step 9: Commit**

```bash
git add backend/app/config.py backend/app/emails.py backend/app/models.py backend/app/schemas.py backend/app/routers/auth.py backend/tests/test_recuperacion.py
git commit -m "feat: recuperacion de contrasena por email (token hasheado, un solo uso)"
```

---

### Task 5: Recuperación — frontend (login, página, ruta) + limpieza de copy

**Files:**
- Modify: `frontend/src/api/client.ts` (recuperar, restablecer — públicos, sin token)
- Modify: `frontend/src/pages/AdminLogin.tsx` (link + estado "enviado"; SACAR la línea Demo)
- Create: `frontend/src/pages/RestablecerPassword.tsx`
- Modify: `frontend/src/router.tsx` (ruta /restablecer-password)

**Interfaces:**
- Consumes: `POST /api/auth/recuperar` (sin body), `POST /api/auth/restablecer` (`{token, password_nueva}`) del Task 4.
- Produces: `api.recuperar()` y `api.restablecer(token, password)` (públicos); ruta `/restablecer-password?token=...`.

- [ ] **Step 1: Métodos en `client.ts`** (junto a `login`, FUERA de `admin:` porque son públicos):

```ts
  // Recuperación de contraseña (públicos, sin token).
  recuperar: () =>
    request<{ ok: boolean; mensaje: string }>("/auth/recuperar", { method: "POST" }),
  restablecer: (token: string, password_nueva: string) =>
    request<{ ok: boolean }>("/auth/restablecer", { method: "POST", body: JSON.stringify({ token, password_nueva }) }),
```

- [ ] **Step 2: `AdminLogin.tsx`** — tres cambios:

a) Estado nuevo (junto a los demás useState):

```tsx
  const [enviado, setEnviado] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
```

b) Función (antes de onSubmit):

```tsx
  async function pedirRecuperacion() {
    setRecError(null);
    setRecuperando(true);
    try {
      await api.recuperar();
      setEnviado(true);
    } catch (e) {
      setRecError((e as Error).message || "No se pudo enviar el email.");
    } finally {
      setRecuperando(false);
    }
  }
```

c) JSX: reemplazar la línea `<p className="text-xs text-gray-500 text-center">Demo: admin / admin123</p>` (spec 5.1: las credenciales NO van a la web pública) por:

```tsx
        {/* "Olvidé mi contraseña": manda el link a los emails fijos del
            backend (spec 4c — no se pide email para no filtrar cuentas). */}
        {enviado ? (
          <p className="text-sm text-green-400 text-center">
            Si existe la cuenta, enviamos un link a los emails registrados. Revisá (y el spam).
          </p>
        ) : (
          <button
            onClick={pedirRecuperacion}
            disabled={recuperando}
            className="block mx-auto text-xs text-gray-500 hover:text-marca disabled:opacity-50"
          >
            {recuperando ? "Enviando…" : "Olvidé mi contraseña"}
          </button>
        )}
        {recError && <p className="text-acento text-xs text-center">{recError}</p>}
```

- [ ] **Step 3: Crear `frontend/src/pages/RestablecerPassword.tsx`** (archivo nuevo, completo)

```tsx
// Página a la que llega el link del email de recuperación (/restablecer-password?token=...).
// El token se lee de la URL; acá se elige la nueva contraseña.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";

export default function RestablecerPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva !== repetir) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (nueva.length < 8) {
      setError("La contraseña necesita al menos 8 caracteres.");
      return;
    }
    setEnviando(true);
    try {
      await api.restablecer(token, nueva);
      // Vuelve al login con un aviso: el flujo terminó bien.
      navigate("/admin", { state: { restablecida: true } });
    } catch (err) {
      setError((err as Error).message || "No se pudo restablecer.");
    } finally {
      setEnviando(false);
    }
  }

  const inputCls = "w-full border border-negro-borde rounded-lg px-3 py-2 bg-negro text-gray-100 placeholder:text-gray-500";

  return (
    <div className="min-h-full flex items-center justify-center bg-negro">
      <form onSubmit={onSubmit} className="bg-negro-panel border border-negro-borde p-6 rounded-xl shadow-md w-80 space-y-4">
        <h1 className="text-xl font-bold text-center text-marca">Nueva contraseña</h1>
        {!token && (
          <p className="text-acento text-sm">
            Falta el token: usá el link completo que llegó por email.
          </p>
        )}
        <input
          type="password"
          className={inputCls}
          placeholder="Contraseña nueva (mín. 8)"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          required
        />
        <input
          type="password"
          className={inputCls}
          placeholder="Repetir la contraseña"
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          required
        />
        {error && <p className="text-acento text-sm">{error}</p>}
        <button
          disabled={enviando || !token}
          className="w-full bg-marca text-black py-2 rounded-lg font-semibold hover:bg-marca-clara disabled:opacity-50"
        >
          {enviando ? "Guardando…" : "Guardar"}
        </button>
        <Link to="/admin" className="block text-center text-sm text-gray-500 hover:text-marca">
          ← Volver al login
        </Link>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Ruta en `router.tsx`** — import y Route (antes del `*`):

```tsx
import RestablecerPassword from "@/pages/RestablecerPassword";
```
```tsx
      <Route path="/restablecer-password" element={<RestablecerPassword />} />
```

y el banner de éxito en `AdminLogin.tsx` (arriba del form, leyendo el state):

```tsx
  const location = useLocation();
  const restablecida = Boolean((location.state as { restablecida?: boolean } | null)?.restablecida);
```
```tsx
        {restablecida && (
          <p className="text-green-400 text-sm text-center">Contraseña restablecida. Entrá con la nueva.</p>
        )}
```

(importar `useLocation` junto a `Link, useNavigate`).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `✓ built in ...`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/pages/AdminLogin.tsx frontend/src/pages/RestablecerPassword.tsx frontend/src/router.tsx
git commit -m "feat: flujo frontend de recuperacion de contrasena + sin credenciales demo"
```

---

### Task 6: Modales propios (reemplazo de los 7 confirm/prompt nativos)

**Files:**
- Create: `frontend/src/components/Modal.tsx`
- Modify: `frontend/src/pages/admin/GestionProductos.tsx` (4 usos)
- Modify: `frontend/src/pages/admin/Combos.tsx` (1 confirm)
- Modify: `frontend/src/pages/admin/GestionPedidos.tsx` (1 confirm + placeholder "Otro")
- Modify: `frontend/src/components/AdminGaleriaImagenes.tsx` (1 confirm)

**Interfaces:**
- Consumes: nada nuevo del backend.
- Produces (Task 7 y el futuro confían en esto):
  - `ConfirmModal({ abierto, titulo, mensaje, alCerrar, alConfirmar, destructivo? })`
  - `ModalInput({ abierto, titulo, mensaje, valorInicial?, alCerrar, alConfirmar })` — `alConfirmar(valor: string)`
  - Convención: Esc o click afuera = cancelar; Enter = confirmar; estética del tema (`bg-negro-panel`).

- [ ] **Step 1: Crear `frontend/src/components/Modal.tsx`** (archivo nuevo, completo)

```tsx
// Modales propios que reemplazan a los confirm()/prompt() nativos (spec 5.4):
// en producción el navegador les antepone la URL de la web — feo y poco
// confiable. Convención: Esc o click FUERA cancelan, Enter confirma.
import { useEffect, useState } from "react";

// Overlay compartido: fondo oscurecido + panel del tema. El click en el
// overlay (fuera del panel) cancela; dentro, no.
function Overlay({
  abierto,
  alCerrar,
  children,
}: {
  abierto: boolean;
  alCerrar: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, alCerrar]);

  if (!abierto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={alCerrar}
    >
      <div
        className="bg-negro-panel border border-negro-borde rounded-xl p-4 m-4 w-80 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Confirmación de una acción (a veces destructiva → botón rojo).
export function ConfirmModal({
  abierto,
  titulo,
  mensaje,
  alCerrar,
  alConfirmar,
  destructivo = false,
}: {
  abierto: boolean;
  titulo: string;
  mensaje: string;
  alCerrar: () => void;
  alConfirmar: () => void;
  destructivo?: boolean;
}) {
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") alConfirmar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, alConfirmar]);

  return (
    <Overlay abierto={abierto} alCerrar={alCerrar}>
      <h3 className="font-bold text-gray-100">{titulo}</h3>
      <p className="text-sm text-gray-400">{mensaje}</p>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={alCerrar} className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:text-white">
          Cancelar
        </button>
        <button
          onClick={alConfirmar}
          autoFocus
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold text-white ${
            destructivo ? "bg-red-600 hover:bg-red-500" : "bg-marca text-black hover:bg-marca-clara"
          }`}
        >
          Confirmar
        </button>
      </div>
    </Overlay>
  );
}

// Pedido de un valor con un input prellenado (reemplaza a prompt()).
export function ModalInput({
  abierto,
  titulo,
  mensaje,
  valorInicial = "",
  alCerrar,
  alConfirmar,
}: {
  abierto: boolean;
  titulo: string;
  mensaje: string;
  valorInicial?: string;
  alCerrar: () => void;
  alConfirmar: (valor: string) => void;
}) {
  // El input vive en estado LOCAL para no pisar el de la página con cada
  // tipeo: se resetea a valorInicial cada vez que el modal abre.
  const [valor, setValor] = useStateSeguro(abierto, valorInicial);

  return (
    <Overlay abierto={abierto} alCerrar={alCerrar}>
      <h3 className="font-bold text-gray-100">{titulo}</h3>
      <p className="text-sm text-gray-400">{mensaje}</p>
      <input
        autoFocus
        className="w-full border border-negro-borde bg-negro text-gray-100 rounded-lg px-3 py-2"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") alConfirmar(valor);
        }}
      />
      <div className="flex justify-end gap-2">
        <button onClick={alCerrar} className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:text-white">
          Cancelar
        </button>
        <button
          onClick={() => alConfirmar(valor)}
          className="bg-marca text-black px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-marca-clara"
        >
          Guardar
        </button>
      </div>
    </Overlay>
  );
}

// Estado que se resetea cuando `abierto` pasa a true (input "fresco" por uso).
function useStateSeguro(abierto: boolean, valorInicial: string): [string, (v: string) => void] {
  const [valor, setValor] = useState(valorInicial);
  useEffect(() => {
    if (abierto) setValor(valorInicial);
  }, [abierto, valorInicial]);
  return [valor, setValor];
}
```

(Nota de estilo: `useStateSeguro` se define DESPUÉS de los componentes que la usan — hoisting de funciones hace que funcione; si preferís, movela arriba. NO la saques: `ModalInput` depende de ella.)

- [ ] **Step 2: GestionProductos.tsx** — 4 reemplazos. Estado al inicio del componente:

```tsx
  const [productoABorrar, setProductoABorrar] = useState<Producto | null>(null);
  const [ofertaDe, setOfertaDe] = useState<Producto | null>(null);
  const [categoriaABorrar, setCategoriaABorrar] = useState<Categoria | null>(null);
  const [categoriaARenombrar, setCategoriaARenombrar] = useState<Categoria | null>(null);
```

`toggleOferta` — abrir modal en vez de prompt:

```tsx
  async function toggleOferta(p: Producto) {
    if (!p.en_oferta) {
      setOfertaDe(p); // el modal pide el precio de oferta
    } else {
      try {
        await api.admin.setOferta(p.id, false, null);
        await cargar();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  async function confirmarOferta(p: Producto, valor: string) {
    setOfertaDe(null);
    const num = parseFloat(valor);
    if (isNaN(num)) return; // misma validación que tenía el prompt
    try {
      await api.admin.setOferta(p.id, true, num);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }
```

`borrar` / `borrarCategoria` — quitar el `if (!confirm(...))` de adentro y mover la acción a un confirmador (el botón que las llama pasa a `setProductoABorrar(p)` / `setCategoriaABorrar(c)`):

```tsx
  async function confirmarBorrado(p: Producto) {
    setProductoABorrar(null);
    try {
      await api.admin.deleteProducto(p.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmarBorradoCategoria(c: Categoria) {
    setCategoriaABorrar(null);
    try {
      await api.admin.deleteCategoria(c.id);
      await cargarCategorias();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmarRenombrado(c: Categoria, nombre: string) {
    setCategoriaARenombrar(null);
    const limpio = nombre.trim();
    if (!limpio || limpio === c.nombre) return;
    try {
      await api.admin.updateCategoria(c.id, { nombre: limpio });
      await cargarCategorias();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }
```

Y al final del JSX del componente (los botones llaman a los setters):

```tsx
      <ConfirmModal
        abierto={productoABorrar !== null}
        titulo="Borrar producto"
        mensaje={`¿Borrar "${productoABorrar?.nombre}"? Los pedidos históricos se conservan.`}
        alCerrar={() => setProductoABorrar(null)}
        alConfirmar={() => productoABorrar && confirmarBorrado(productoABorrar)}
        destructivo
      />
      <ModalInput
        abierto={ofertaDe !== null}
        titulo="Precio de oferta"
        mensaje={`Precio de oferta para "${ofertaDe?.nombre}" (normal: $${ofertaDe?.precio}):`}
        alCerrar={() => setOfertaDe(null)}
        alConfirmar={(v) => ofertaDe && confirmarOferta(ofertaDe, v)}
      />
      <ConfirmModal
        abierto={categoriaABorrar !== null}
        titulo="Borrar categoría"
        mensaje={`¿Borrar la categoría "${categoriaABorrar?.nombre}"? Solo se puede si no tiene productos.`}
        alCerrar={() => setCategoriaABorrar(null)}
        alConfirmar={() => categoriaABorrar && confirmarBorradoCategoria(categoriaABorrar)}
        destructivo
      />
      <ModalInput
        abierto={categoriaARenombrar !== null}
        titulo="Renombrar categoría"
        mensaje={`Nuevo nombre para "${categoriaARenombrar?.nombre}":`}
        valorInicial={categoriaARenombrar?.nombre ?? ""}
        alCerrar={() => setCategoriaARenombrar(null)}
        alConfirmar={(v) => categoriaARenombrar && confirmarRenombrado(categoriaARenombrar, v)}
      />
```

- [ ] **Step 3: Combos.tsx** — el confirm está dentro de `AdminComboCard` (línea 342; es quien tiene `combo: c`, `onRecargar` y `onError`, así que el estado y el modal viven ahí, sin tocar la página):

```tsx
  const [comboABorrar, setComboABorrar] = useState(false);
```

(el botón "Borrar" del confirm pasa a `onClick={() => setComboABorrar(true)}`) y al final del JSX de la card (después del bloque `flex flex-wrap`, antes del cierre):

```tsx
      <ConfirmModal
        abierto={comboABorrar}
        titulo="Borrar combo"
        mensaje={`¿Borrar el combo "${c.nombre}"? Los pedidos históricos se conservan.`}
        alCerrar={() => setComboABorrar(false)}
        alConfirmar={async () => {
          setComboABorrar(false);
          try {
            await api.admin.deleteCombo(c.id);
            await onRecargar();
          } catch (e) {
            onError((e as Error).message);
          }
        }}
        destructivo
      />
```

(importar `ConfirmModal` arriba, junto a los imports de AdminGaleriaImagenes).

- [ ] **Step 4: GestionPedidos.tsx** — dos cambios:

a) Cancelar pedido: en `GestionPedidos` (el padre, donde está `cancelar`):

```tsx
  const [pedidoACancelar, setPedidoACancelar] = useState<PedidoOut | null>(null);

  async function confirmarCancelado(p: PedidoOut) {
    setPedidoACancelar(null);
    try {
      await api.admin.cancelarPedido(p.id);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }
```

(la función `cancelar` actual con su confirm() se BORRA; el `onCancelar` que se pasa a PedidoCard pasa a ser `setPedidoACancelar`) y al final del JSX:

```tsx
      <ConfirmModal
        abierto={pedidoACancelar !== null}
        titulo="Cancelar pedido"
        mensaje="¿Cancelar este pedido? El stock se reintegra a la venta."
        alCerrar={() => setPedidoACancelar(null)}
        alConfirmar={() => pedidoACancelar && confirmarCancelado(pedidoACancelar)}
        destructivo
      />
```

b) Placeholder del "Otro" (spec 5.2): en el input del ítem "Otro", `placeholder='Nombre del extra (ej. "bacon extra")'` pasa a `placeholder=""` (quitar el atributo).

- [ ] **Step 5: AdminGaleriaImagenes.tsx** — borrar foto:

```tsx
  const [fotoABorrar, setFotoABorrar] = useState<number | null>(null);
```

la función `borrar` pierde el confirm() (el botón ✕ pasa a `setFotoABorrar(img.id)`), y:

```tsx
  async function confirmarBorradoFoto(imagenId: number) {
    setFotoABorrar(null);
    try {
      await api.admin.deleteImagen(producto.id, imagenId);
      onRecargar();
    } catch (e) {
      onError((e as Error).message);
    }
  }
```

y al final del JSX:

```tsx
      <ConfirmModal
        abierto={fotoABorrar !== null}
        titulo="Borrar foto"
        mensaje="¿Borrar esta foto? Se quita de la galería (la principal pasa a la siguiente)."
        alCerrar={() => setFotoABorrar(null)}
        alConfirmar={() => fotoABorrar !== null && confirmarBorradoFoto(fotoABorrar)}
        destructivo
      />
```

- [ ] **Step 6: Verificar que no queden nativos**

Run: `grep -rn "confirm(\|prompt(" frontend/src --include=*.tsx`
Expected: solo matcheos en comentarios (ningún `confirm(`/`prompt(` ejecutable)

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: `✓ built in ...`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Modal.tsx frontend/src/pages/admin/GestionProductos.tsx frontend/src/pages/admin/Combos.tsx frontend/src/pages/admin/GestionPedidos.tsx frontend/src/components/AdminGaleriaImagenes.tsx
git commit -m "feat: modales propios en vez de confirm/prompt nativos"
```

---

### Task 7: Artefactos de deploy + límite 4.5MB + docs

**Files:**
- Create: `backend/vercel.json`
- Modify: `backend/app/routers/productos.py:290-291` (límite 5MB → 4.5MB)
- Modify: `frontend/src/api/client.ts` (check de tamaño en uploadImagen)
- Test: `backend/tests/test_galeria.py` (1 test nuevo)
- Modify: `ESTADO-PROYECTO.md`, `README.md`

**Interfaces:**
- Consumes: `guardar_archivo` (Task 1), `uploadImagen` en client.ts (el único embudo por donde suben fotos el alta de producto y la galería).
- Produces: `vercel.json` (excluye tests del bundle); límite de imagen alineado a 4.5MB (límite de body de Vercel) en backend Y frontend.

- [ ] **Step 1: Test FALLANDO — en `test_galeria.py`, agregar:**

```python
def test_subir_imagen_muy_grande_400(cliente, admin_headers, crear_producto):
    """Vercel serverless rechaza BODIES > 4.5MB: una foto de celular puede
    superar eso, y el error de Vercel (413) no se explicaría solo. El backend
    corta ANTES, con un mensaje claro, y no guarda nada."""
    p = crear_producto()
    resp = _subir_grande = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("foto.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024), "image/png")},
        headers=admin_headers,
    )
    assert resp.status_code == 400
    detalle = cliente.get(f"/api/productos/{p['id']}").json()
    assert detalle["imagenes"] == []
```

- [ ] **Step 2: Verlo fallar**

Run: `./venv/Scripts/python.exe -m pytest tests/test_galeria.py::test_subir_imagen_muy_grande_400 -v`
Expected: FAIL — hoy el límite es 5MB y esta imagen de 5MB (5*1024*1024 de ceros) pasa

- [ ] **Step 3: Backend — en `productos.py`, subir_imagen:**

```python
    datos = await archivo.read()
    # 4.5MB: el límite de BODY de Vercel (serverless) — una foto de celular
    # puede superarlo y el 413 de Vercel no se entiende solo. Rechazamos acá
    # con mensaje claro (el check del frontend evita el viaje inútil).
    if len(datos) > int(4.5 * 1024 * 1024):
        raise HTTPException(status_code=400, detail="La imagen supera los 4.5 MB")
```

(reemplaza el bloque `if len(datos) > 5 * 1024 * 1024: ...` y su comentario anterior).

- [ ] **Step 4: Frontend — en `client.ts`, al inicio de `uploadImagen`:**

```ts
    uploadImagen: async (id: number, file: File) => {
      // Vercel serverless rechaza bodies > 4.5MB con un 413 críptico: cortamos
      // acá, en el único embudo por donde suben fotos (alta y galería), con
      // un mensaje que el dueño entienda.
      if (file.size > 4.5 * 1024 * 1024) {
        throw new Error(`La imagen supera los 4.5 MB (${(file.size / 1024 / 1024).toFixed(1)} MB). Comprimila o sacala con menos resolución.`);
      }
      // ... (lo que ya sigue: FormData + request)
```

- [ ] **Step 5: Crear `backend/vercel.json`** (archivo nuevo, completo)

```json
{
  "functions": {
    "app/main.py": {
      "excludeFiles": "{tests,venv,.venv,__pycache__,.pytest_cache,uploads}/**"
    }
  }
}
```

- [ ] **Step 6: Suite + build**

Run: `./venv/Scripts/python.exe -m pytest -v`
Expected: 53 passed (52 + 1 nuevo)

Run: `npm run build`
Expected: `✓ built in ...`

- [ ] **Step 7: Docs — tres ediciones en `ESTADO-PROYECTO.md`:**

a) En la sección "Sesión 2026-09-27/28", cambiar la línea de estado:

```markdown
> Estado al cerrar la sesión: **especificado y aprobado, SIN implementar todavía**.
```
por:
```markdown
> Estado: **IMPLEMENTADO** (helper Blob, credenciales, recuperación, modales).
> Pendiente de ejecutar: los pasos de deploy (crear Neon + proyectos Vercel +
> seed contra prod), ver sección "Deploy".
```

b) Actualizar la línea de verificación de la misma sección a los números reales de suite (53 tests).

c) En "Datos importantes", reemplazar `Admin demo: admin / admin123 (se carga con seed.py)` por:

```markdown
- Admin inicial: `ADMIN_USERNAME` / `ADMIN_PASSWORD` del entorno (requeridas
  para el seed; luego el dueño la cambia desde Ajustes). Ya NO hay
  admin/admin123 hardcodeado.
```

d) En "Tests del backend", actualizar el número de tests si menciona cantidad (hoy no la menciona — verificar y dejar consistente).

En `README.md`: actualizar cualquier mención a `admin` / `admin123` y a la sección de cómo correr/deployar con los pasos actuales (si el README ya está al día en lo demás, solo eso).

- [ ] **Step 8: Commit**

```bash
git add backend/vercel.json backend/app/routers/productos.py backend/tests/test_galeria.py frontend/src/api/client.ts ESTADO-PROYECTO.md README.md
git commit -m "feat: artefactos de deploy (vercel.json), limite 4.5MB y docs al dia"
```

---

## Nota final para el ejecutor

- Orden de tasks: 1 → 7 sin reordenar (el 4 consume config del 1/2; el 7 mide el límite que el 1 tocó).
- Si un test falla por comportamiento existente, es un BUG o un plan defecto: ruling al ledger, nunca editar el test para que pase.
- El deploy mismo (crear Neon, proyectos Vercel, seed contra prod) NO es parte de este plan: es el paso 6 de la spec y lo hace el dueño con su cuenta; este plan deja TODO el código y los artefactos listos.