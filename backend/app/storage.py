"""
Helper ÚNICO para guardar y borrar archivos de imágenes, con switch por entorno
(spec 2026-09-27 §3):

  - SIN settings.blob_read_write_token (dev, Docker, tests): el archivo se
    guarda en el disco backend/uploads/ y la URL es RELATIVA ("/uploads/<nombre"),
    servida por StaticFiles (dev) o por el proxy de Vite. Los tests parchean
    UPLOAD_DIR al directorio temporal (ver tests/conftest.py).

  - CON token (producción en Vercel): HTTP directo a la API REST de Vercel Blob
    con la stdlib (sin SDK de Node). Blob responde una URL ABSOLUTA (CDN), que
    se guarda tal cual en la DB — el frontend ya consume URLs tal cual, así que
    nada más cambia. NOTA: en prod el disco es efímero (serverless), por eso
    SIEMPRE que haya token se va por Blob aunque sea un solo archivo.

Los routers (productos, config_local) NO escriben disco a mano: llaman acá.
"""
import json
import os
import time
import urllib.request
import uuid as uuid_lib

from app.config import settings

# Misma carpeta que usaba productos.py: backend/uploads/. El cálculo es "2
# dirnames" (app/storage.py -> app/ -> backend/) y NO "3 dirnames" porque
# storage.py vive en app/ directo (productos.py estaba en app/routers/).
UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads"
)

_BLOB_API = "https://vercel.com/api/blob"
_BLOB_API_VERSION = "13"  # x-api-version: el valor que manda el SDK @vercel/blob
_BLOB_TIMEOUT = 30  # segundos: archivos <= 5 MB, sin margen excesivo


def _store_id_del_token(token: str) -> str:
    """El token es 'vercel_blob_rw_<storeId>_<random>': el storeId es el 4to
    tramo (así lo parsea el SDK oficial, helpers.ts)."""
    tramos = token.split("_")
    return tramos[3] if len(tramos) > 3 else ""


def _headers_blob(token: str) -> dict:
    """Headers de CONTEXTO que el API de Blob exige en TODAS sus llamadas
    (requestApi del SDK @vercel/blob): request-id, store-id, attempt, versión.
    Nuestros primeros PUTs murieron con 400 por omitirlos — con auth OIDC el
    store-id ni siquiera viaja dentro del token."""
    store_id = _store_id_del_token(token)
    return {
        "authorization": f"Bearer {token}",
        "x-vercel-blob-store-id": store_id,
        "x-api-blob-request-id": f"{store_id}:{int(time.time() * 1000)}:{uuid_lib.uuid4().hex[:12]}",
        "x-api-blob-request-attempt": "0",
        "x-api-version": _BLOB_API_VERSION,
    }


def guardar_archivo(nombre: str, contenido: bytes, content_type: str) -> str:
    """Guarda una imagen y devuelve su URL para guardar en la DB.

    - Dev: archivo en UPLOAD_DIR, URL relativa /uploads/<nombre>.
    - Prod: sube a Blob y devuelve la URL absoluta del CDN.

    `nombre` lo arma el llamador (con uuid y extensión; ej. "12_abc.jpg",
    "logo_abc.png"). Puede traer subcarpeta: se crea si falta (dev).
    """
    if settings.blob_read_write_token:
        from urllib.parse import quote

        token = settings.blob_read_write_token
        headers = _headers_blob(token)
        headers.update(
            {
                "x-content-type": content_type,
                "x-vercel-blob-access": "public",
                "x-add-random-suffix": "1",
            }
        )
        req = urllib.request.Request(
            f"{_BLOB_API}/?pathname={quote(nombre, safe='')}",
            data=contenido,
            method="PUT",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=_BLOB_TIMEOUT) as resp:
            data = json.loads(resp.read())
        return data["url"]

    destino = os.path.join(UPLOAD_DIR, nombre)
    os.makedirs(os.path.dirname(destino) or UPLOAD_DIR, exist_ok=True)
    with open(destino, "wb") as f:
        f.write(contenido)
    return f"/uploads/{nombre}"


def borrar_archivo(url: str) -> None:
    """Borra una imagen guardada por guardar_archivo. Si el archivo ya no
    existe, NO explota (mismo criterio que el borrado de fotos de productos).

    La URL puede ser relativa (/uploads/x.jpg, dev) o absoluta de Blob (prod).
    """
    if not url:
        return
    if settings.blob_read_write_token and url.startswith("http"):
        req = urllib.request.Request(
            f"{_BLOB_API}/delete",
            data=json.dumps({"urls": [url]}).encode(),
            method="POST",
            headers={**_headers_blob(settings.blob_read_write_token), "Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=_BLOB_TIMEOUT)
        return

    archivo = os.path.join(UPLOAD_DIR, url.rsplit("/", 1)[-1])
    try:
        os.remove(archivo)
    except OSError:
        pass