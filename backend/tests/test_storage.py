"""
Tests del helper de archivos (app/storage.py).

Reglas que fijan:
  - SIN BLOB_READ_WRITE_TOKEN (dev y tests): el archivo vive en UPLOAD_DIR y
    la URL es relativa "/uploads/<nombre>" — comportamiento de siempre.
  - CON token (prod): el archivo viaja a la API REST de Vercel Blob por HTTP
    (sin SDK) y se devuelve la URL absoluta que responde Blob.
  - borrar_archivo no explota si el archivo ya no existe (mismo criterio que
    venían usando subir/borrar en productos.py).
"""
import json
import urllib.request

from app import storage
from app.config import settings

# PNG con content_type image/* (mismo criterio que test_galeria: la validación
# del endpoint es por content_type; el contenido alcanza con una cabecera).
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_sin_token_guarda_en_disco_y_devuelve_ruta_relativa(cliente, uploads_dir, monkeypatch):
    # El fixture cliente existe para que Base.metadata esté creado, pero acá
    # solo probamos el helper: nos aseguramos de que NO haya token.
    monkeypatch.setattr(settings, "blob_read_write_token", "")
    url = storage.guardar_archivo("fotos/hola.png", b"contenido", "image/png")
    assert url == "/uploads/hola.png" or url.replace("\\", "/").endswith("hola.png")
    # La URL es RELATIVA (arranca con /uploads/): el frontend la consume tal cual.
    assert url.startswith("/uploads/")
    # El archivo existe físicamente en el directorio de uploads mockeado.
    assert len(list(uploads_dir.glob("*"))) >= 1


def test_borrar_archivo_inexistente_no_explota(cliente, uploads_dir, monkeypatch):
    monkeypatch.setattr(settings, "blob_read_write_token", "")
    storage.borrar_archivo("/uploads/no-existe.jpg")  # no lanza


def test_borrar_archivo_en_disco(cliente, uploads_dir, monkeypatch):
    monkeypatch.setattr(settings, "blob_read_write_token", "")
    url = storage.guardar_archivo("a.png", b"x", "image/png")
    storage.borrar_archivo(url)
    assert len(list(uploads_dir.glob("*"))) == 0


def test_con_token_guarda_en_blob_y_devuelve_url_absoluta(monkeypatch):
    """Con token, el helper consulta la API REST de Blob (mockeada con
    urllib) y devuelve la URL absoluta que Blob responde."""
    monkeypatch.setattr(settings, "blob_read_write_token", "vercel_blob_rw_test")

    capturado: dict = {}

    class RespuestaFalsa:
        def __init__(self, cuerpo: bytes):
            self.cuerpo = cuerpo

        def read(self):
            return self.cuerpo

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return None

    def request_falsa(req, timeout=None):
        capturado["req"] = req
        return RespuestaFalsa(json.dumps({"url": "https://abc.blob.vercel-storage.com/x.png"}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", request_falsa)

    url = storage.guardar_archivo("12_abc.png", b"datos", "image/png")

    req = capturado["req"]
    assert url == "https://abc.blob.vercel-storage.com/x.png"
    assert "pathname=12_abc" in req.full_url or "pathname=12_abc.png" in req.full_url
    headers = {k.lower(): v for k, v in req.headers.items()}
    assert headers["authorization"] == "Bearer vercel_blob_rw_test"
    assert headers["x-content-type"] == "image/png"


# ---------- Critical #1 (review): main.py en serverless ----------
def _caminos(app) -> set:
    """starlette 1.x: app.routes mezcla monturas y '_IncludedRouter' sin .path —
    usamos getattr para tolerar ambos."""
    return {getattr(r, "path", None) or getattr(r, "path_format", "") for r in app.routes}


def test_import_main_con_token_no_intenta_montar_disco(monkeypatch):
    """En Vercel el filesystem de la función es DE SOLO LECTURA: si el import
    de app.main intentara makedirs/mount StaticFiles, TODA la app crashea al
    importar (ni /api/health responde). Con token Blob, el mount no se hace."""
    import importlib

    monkeypatch.setattr(settings, "blob_read_write_token", "tok-prod")
    from app import main

    main_recargado = importlib.reload(main)  # si crashea, el test explota acá
    rutas = _caminos(main_recargado.app)
    assert "/uploads" not in rutas
    assert "/api/health" in rutas


def test_import_main_sin_token_monta_uploads(monkeypatch):
    """Dev (sin token): /uploads sigue sirviendo del disco (comportamiento actual)."""
    import importlib

    monkeypatch.setattr(settings, "blob_read_write_token", "")
    from app import main

    main_recargado = importlib.reload(main)
    assert "/uploads" in _caminos(main_recargado.app)


# ---------- Important #2 (review): borrar producto en Blob-mode ----------
def test_borrar_producto_delega_cada_foto_al_helper(cliente, admin_headers, crear_producto, monkeypatch):
    """El dueño borra un producto: TODAS sus fotos deben borrarse vía
    storage.borrar_archivo (en prod son URLs absolutas de Blob — el glob de
    disco del código viejo nunca las matchea y quedan huérfanas de por vida)."""
    llamadas: list[str] = []
    original = storage.borrar_archivo

    def espia(url):
        llamadas.append(url)
        original(url)

    monkeypatch.setattr(storage, "borrar_archivo", espia)
    from app.routers import productos as router_productos  # noqa: F401 (garantiza el import del router)

    p = crear_producto()
    resp1 = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("a.png", PNG, "image/png")},
        headers=admin_headers,
    )
    resp2 = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("b.png", PNG, "image/png")},
        headers=admin_headers,
    )
    assert resp1.status_code == 200 and resp2.status_code == 200
    llamadas.clear()

    resp = cliente.delete(f"/api/productos/{p['id']}", headers=admin_headers)
    assert resp.status_code == 204
    urls_de_las_fotos = {i["url"] for i in resp2.json()["imagenes"]}
    assert set(llamadas) == urls_de_las_fotos  # cada foto borrada por su URL


def test_subir_imagen_con_error_de_guardado_muestra_la_causa(cliente, admin_headers, crear_producto, monkeypatch):
    """Si guardar_archivo truena (Blob rechazado, FS read-only...), la respuesta
    NO puede ser un 500 genérico: el dueño ve la CAUSA en el panel (así un
    problema de storage se diagnosticó en el deploy real sin logs de servidor)."""
    def explotar(*a, **k):
        raise RuntimeError("blob PUT 403")

    monkeypatch.setattr(storage, "guardar_archivo", explotar)
    p = crear_producto()
    r = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("a.png", PNG, "image/png")},
        headers=admin_headers,
    )
    assert r.status_code == 500
    assert "blob PUT 403" in r.json()["detail"]