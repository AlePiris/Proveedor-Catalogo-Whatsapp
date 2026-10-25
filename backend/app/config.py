"""
Configuración central del backend.

Lee las variables de entorno y las expone como `settings`. Usamos
pydantic-settings porque valida los tipos (si te equivocás en un número, falla
al arrancar, no en runtime) y porque separa los secretos del código.

Variables (con valor por defecto para desarrollo local):
  DATABASE_URL   cadena de conexión a Postgres
  JWT_SECRET     clave para firmar los tokens de login del admin
  CORS_ORIGINS   URLs del frontend permitidas (separadas por coma)
  WA_NUMBER      número de WhatsApp de la pizzería (lo usa el frontend, pero lo
                 dejamos aquí documentado; el frontend lo toma de sus propias vars)
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # model_config: le dice a pydantic que lea de un archivo .env si existe.
    # case_sensitive=False: las claves del .env (ej. DATABASE_URL) matchean los
    # campos aunque estén en minúsculas (database_url). En Windows las variables
    # del SO ya son case-insensitive, pero las del ARCHIVO .env no: por eso
    # necesitamos False acá, si no el .env se ignora silenciosamente.
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    # URL de conexión. En dev apunta al Postgres del docker-compose; en prod,
    # a Neon. SQLAlchemy la consume igual.
    database_url: str = "postgresql+psycopg2://pizzeria:pizzeria@localhost:5432/pizzeria"

    # Secreto para firmar JWT. En prod va en una var de entorno real (larga y
    # aleatoria). Acá un default solo para no romper en dev.
    jwt_secret: str = "cambiar-en-produccion"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 horas: el dueño se loguea y le dura el día

    # Orígenes permitidos para CORS. En dev el frontend corre en 5173; en prod
    # será la URL de Vercel. Lista separada por comas.
    cors_origins: str = "http://localhost:5173"

    # Token de Vercel Blob (lo genera Vercel al vincular el store). Vacío = dev:
    # guardar_archivo/borrar_archivo usan el disco backend/uploads/. Con token =
    # prod: HTTP directo a la API REST de Blob (ver app/storage.py).
    blob_read_write_token: str = ""

    # Credenciales del admin que crea el seed (spec deploy §4a). SIN defaults:
    # el seed corta con error si faltan — nunca admin/admin123 hardcodeado. En
    # dev van en backend/.env; en prod, en las env vars del proyecto Vercel.
    admin_username: str = ""
    admin_password: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        """Convierte el string "a,b" en una lista ["a","b"], quitando espacios."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


# Una sola instancia compartida por toda la app (patrón singleton de facto).
settings = Settings()