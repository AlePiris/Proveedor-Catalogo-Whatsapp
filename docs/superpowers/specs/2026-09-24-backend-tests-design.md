# Diseño: Subsistema de tests del backend (pytest)

> Fecha: 2026-09-24 · Estado: borrador para revisión
> Clasificación Superpowers: **architectural** (subsistema nuevo: el repo tiene cero tests).

## Contexto y decisiones previas

Este spec nace de una sesión de brainstorming con tres candidatos; dos quedaron
resueltos o descartados:

- **Vercel Blob (migración de uploads): POSTERGADO.** El proyecto corre solo
  local (uvicorn + SQLite/Postgres de dev); no existe deploy serverless, así
  que el disco local funciona y no hay razón de negocio para migrar hoy.
  Vuelve a la agenda cuando exista deploy real en Vercel.
- **Unificar el patrón de `confirm()`: DESCARTADO.** Era una observación
  errónea: `confirm()` nativo ya ES el patrón de todo el admin
  (`GestionPedidos`, `GestionProductos`, `Combos`, `AdminGaleriaImagenes`).
- **Tests del backend: este spec.** Aprobado enfoque A (ver abajo).

## Objetivo

Correr `pytest` desde `backend/` ejecuta una suite confiable sobre una base
de datos **aislada** (nunca la `.db` de desarrollo), que protege los flujos
críticos del negocio y sirve de evidencia de calidad para la entrega del
integrador.

Criterio de éxito: `venv\Scripts\python.exe -m pytest` en verde desde un
clon limpio, sin tocar datos reales ni `backend/uploads/`.

## Alcance (flujos críticos)

1. **Galería de imágenes** (`routers/productos.py`): subir/borrar/marcar
   principal, y la sincronización con `imagen_url` denormalizada.
2. **Stock de combos** (`_stock_combo_efectivo`): stock efectivo = mínimo de
   componentes, visibilidad en el catálogo público.
3. **Ciclo de vida de pedidos** (`routers/pedidos.py`): snapshot de precios
   del backend, descuento de stock al crear, reintegro al cancelar/editar,
   validación de elecciones de grupos.

**Fuera de alcance (v1):** auth completa (solo se ejercita como fixture),
categorías, análisis de más vendidos, config local, el backfill de
`init_db.py`, y tests del frontend.

## Enfoque aprobado: A — TestClient + SQLite en memoria + overrides

- **`fastapi.testclient.TestClient`**: los tests llaman a los endpoints de
  verdad (HTTP simulado), probando el contrato completo: códigos de estado,
  validación Pydantic, auth.
- **Base de test propia**: engine `sqlite:///:memory:` con
  `StaticPool` + `check_same_thread=False`.

  > Motivo técnico: `app/database.py` usa `NullPool` (conexión nueva por
  > request, decisión serverless-safe). Con SQLite en memoria y NullPool cada
  > conexión vería una base distinta (la base muere con la conexión).
  > `StaticPool` comparte UNA conexión para todo el test → el esquema creado
  > es visible desde todos los requests. El engine de producción no se toca.
- **Inyección**: `app.dependency_overrides[get_db]` entrega sesiones bound al
  engine de test. `settings.DATABASE_URL` queda irrelevante para los tests.
- **Esquema por test**: `Base.metadata.create_all` al empezar cada test,
  `drop_all` al terminar (aislamiento total entre tests).
- **Auth real, no mockeada**: fixture que crea un `AdminUser` real y firma un
  token con `crear_token()`; los tests mandan `Authorization: Bearer ...`.
  Así el stack JWT completo se ejercita en cada request admin.
- **Uploads a directorio temporal**: monkeypatch de
  `app.routers.productos.UPLOAD_DIR` hacia `tmp_path`. Los tests de galería
  escriben/borran archivos ahí; `backend/uploads/` real queda intacto.
- **Vercel Blob** sigue fuera; los tests no dependen de su futura migración
  (abstraen sobre las URLs `/uploads/...`, que seguirán siendo la respuesta
  de la API).

## Estructura de archivos

```
backend/
  requirements-dev.txt        # pytest, httpx (TestClient lo requiere)
  pyproject.toml              # + [tool.pytest.ini_options] (testpaths, pythonpath)
  tests/
    conftest.py               # fixtures compartidas (ver abajo)
    test_galeria.py
    test_combos.py
    test_pedidos.py
```

## Fixtures (`conftest.py`)

| Fixture | Scope | Qué da |
|---|---|---|
| `engine` | función | engine SQLite memoria + StaticPool |
| `cliente` | función | `TestClient(app)` con `get_db` overridado, esquema creado; al terminar `drop_all` y limpieza del override. |
| `headers_admin` | función | `{"Authorization": "Bearer <token>}` de un `AdminUser` creado en la base de test. |
| `producto` | función | un producto simple (con stock) creado vía API o DB. |
| `combo` | función | combo con un grupo a elección (N>1 y N=1) + componentes fijos. |
| monkeypatch de `UPLOAD_DIR` | función | apunta a `tmp_path / "uploads"`. |

`conftest.py` se comenta con el mismo estilo didáctico del resto del
proyecto (explicar el *porqué*, no solo el qué).

## Casos de test (comportamiento, no implementación)

**`test_galeria.py`**
- Subir la primera imagen → es la principal (`imagen_url` actualizado) y
  aparece en la galería con orden 0.
- Subir una segunda → se agrega a la galería, la principal NO cambia.
- Subir un archivo con extensión no permitida → 4xx.
- Marcar la segunda como principal → `imagen_url` cambia y el orden se
  renumera (la elegida pasa al frente).
- Borrar la principal → se promueve la siguiente por orden (y desempate id).
- Borrar la única imagen → `imagen_url` queda `None`.
- Borrar una imagen inexistente → 404.
- El archivo físico vive en el directorio temporal y se borra junto a la
  fila; borrar el producto limpia todos sus archivos `{id}_*`.
- Endpoints admin sin token → 401.

**`test_combos.py`**
- Stock efectivo de un combo = mínimo del stock de sus componentes (se ve
  en el `stock` del catálogo público).
- Combo con un componente agotado no aparece en el catálogo público (salvo
  `mostrar_sin_stock`); el admin lo sigue viendo en `/api/productos/admin`.
- Producto simple sin stock no aparece en el público.

**`test_pedidos.py`**
- Crear un pedido simple → total con precios del BACKEND (snapshot), stock
  descontado.
- Crear un pedido de combo con elecciones válidas → ok; stock de los
  componentes elegidos descontado.
- Elecciones inválidas → 4xx: suma del grupo ≠ N, opción fuera del grupo,
  cantidad negativa.
- Pedir más de lo que hay en stock → rechazado.
- Confirmar un pedido pendiente → estado `confirmada`.
- Cancelar un pedido → el stock reintegra exactamente lo descontado.
- Editar items de un pedido pendiente → el total se recalcula y la
  diferencia de stock se reintegra/descuenta.

## Manejo de errores y aislamiento

- Ningún test lee ni escribe `backend/.db`, `backend/.env` obligatorio, ni
  `backend/uploads/`: si un fixture detecta eso, falla explícito.
- Los tests no dependen entre sí: cada uno parte de esquema + datos propios
  (create_all por test). Pueden correrse sueltos o en cualquier orden.

## Testing de la suite misma

- `pytest -q` verde desde un checkout limpio tras
  `pip install -r requirements.txt -r requirements-dev.txt`.
- Convención: si un test falla, se arregla el test O el código, nunca se
  "apaga" el test. TDD para cada test nuevo que se agregue después.

## Supuestos abiertos (los cierra el plan de implementación)

- Los códigos exactos de cada rechazo (400 vs 409 vs 422) se toman de lo que
  los routers ya devuelven hoy; el plan los enumera leyendo el código, no
  inventa.
- Cómo sembrar el combo del fixture (API admin vs. filas directas) se decide
  en el plan buscando el camino más corto legible.