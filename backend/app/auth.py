"""
Autenticación del admin: hash de passwords + JWT + dependencia require_admin.

Flujo:
  1. El dueño manda username/password a /api/auth/login.
  2. Verificamos el password contra el hash guardado (passlib + bcrypt).
  3. Si está bien, firmamos un JWT con el id del admin (python-jose).
  4. El frontend guarda el token y lo manda en Authorization: Bearer <token>.
  5. En cada endpoint admin, la dependencia require_admin verifica el token y
     nos entrega el usuario. Si el token falta o es inválido, devuelve 401.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AdminUser

# Esquema que extrae el token del header "Authorization: Bearer ...".
# tokenUrl es la ruta del login (solo para que /docs muestre el botón "Authorize").
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


# Usamos bcrypt directamente (sin passlib) porque passlib 1.7 es incompatible
# con bcrypt 4.x. bcrypt es el estándar: agrega "salt" automático y es lento a
# propósito para que adivinar passwords por fuerza bruta sea inviable.
def hash_password(plain: str) -> str:
    """Convierte una password en claro a un hash bcrypt (para guardar)."""
    # bcrypt trabaja con bytes; encodeamos/decodeamos para guardar como str en la DB.
    # gensalt() genera el salt aleatorio que se incrusta en el hash resultante.
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Compara la password en claro con el hash guardado. Devuelve True si coinciden."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        # Si el hash guardado está corrupto, no es password válida.
        return False


def crear_token(admin_id: int) -> str:
    """Crea un JWT firmado con el id del admin y fecha de expiración."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(admin_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_admin_actual(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> AdminUser:
    """
    Dependencia: valida el token y devuelve el AdminUser.
    Si el token falta, está malformado o el admin no existe -> 401.
    """
    credenciales_invalidas = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        admin_id = int(payload.get("sub", 0))
    except (JWTError, ValueError):
        raise credenciales_invalidas

    admin = db.query(AdminUser).filter(AdminUser.id == admin_id).first()
    if admin is None:
        raise credenciales_invalidas
    return admin


# Alias con nombre claro para usar en los endpoints admin.
require_admin = get_admin_actual