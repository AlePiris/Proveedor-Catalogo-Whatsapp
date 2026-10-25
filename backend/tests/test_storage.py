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