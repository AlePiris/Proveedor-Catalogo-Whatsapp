"""
Punto de entrada de la aplicación FastAPI.

Acá se crea la instancia `app`, se configura CORS y se montan todos los routers
(cada uno aporta sus endpoints). Es el "pegamento" que une los módulos.

Vercel detecta esta variable `app` y la sirve como función serverless.
Localmente se corre con:  uvicorn app.main:app --reload
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import storage
from app.config import settings
from app.routers import auth, productos, pedidos, analisis, config_local, categorias

app = FastAPI(
    title="Pizzería API",
    description="Backend del trabajo integrador: productos, pedidos y análisis.",
    version="1.0.0",
)

# Sirve las imágenes subidas bajo /uploads — SOLO DEV (disco backend/uploads/,
# la MISMA carpeta que escribe app/storage.py; un solo cálculo de ruta en el repo).
# En PROD serverless el filesystem es de solo lectura: hacer makedirs/mount al
# importar crashea TODA la app (ni /api/health responde) — y las fotos van a
# Vercel Blob, así que el mount sobra. El guard + try hace a la app imposible
# de derribar por esto, incluso con una config a medias.
if not settings.blob_read_write_token:
    try:
        os.makedirs(storage.UPLOAD_DIR, exist_ok=True)
        app.mount("/uploads", StaticFiles(directory=storage.UPLOAD_DIR), name="uploads")
    except OSError:
        print(f"[main] No se pudo montar /uploads: sin token Blob Y disk no escribible")

# CORS: permite que el frontend (otro origen) llame a esta API. En dev es
# localhost:5173; en prod, la URL de Vercel. allow_credentials=True prepara para
# el caso de usar cookies (acá usamos header Authorization, pero no estorba).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montamos los routers. Cada uno trae sus rutas bajo su prefijo.
app.include_router(auth.router)
app.include_router(productos.router)
app.include_router(productos.combos_router)
app.include_router(pedidos.router)
app.include_router(analisis.router)
app.include_router(config_local.router)
app.include_router(categorias.router)


@app.get("/api/health")
def health():
    """Endpoint de prueba: para verificar que la API responde (lo usa el deploy)."""
    return {"status": "ok"}