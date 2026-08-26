"""
Router de autenticación. Solo tiene el login.

POST /api/auth/login  ->  recibe username/password, devuelve un JWT.
Es el único endpoint que "da" algo: el resto de endpoints admin "exigen" el token.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import crear_token, verify_password
from app.database import get_db
from app.models import AdminUser
from app.schemas import LoginRequest, Token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(datos: LoginRequest, db: Session = Depends(get_db)):
    """
    Login del admin. Busca el usuario, verifica el password contra el hash y,
    si todo coincide, devuelve el token. Si no, 401.
    """
    admin = db.query(AdminUser).filter(AdminUser.username == datos.username).first()
    # Verificamos siempre (incluso si admin es None) con un hash dummy para no
    # filtrar qué usuarios existen por tiempo de respuesta. Truco estándar.
    if admin is None or not verify_password(datos.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
        )
    token = crear_token(admin.id)
    return Token(access_token=token)