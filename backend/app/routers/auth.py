"""
Router de autenticación. Solo tiene el login.

POST /api/auth/login  ->  recibe username/password, devuelve un JWT.
Es el único endpoint que "da" algo: el resto de endpoints admin "exigen" el token.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import crear_token, hash_password, require_admin, verify_password
from app.database import get_db
from app.models import AdminUser
from app.schemas import LoginRequest, Token, PasswordChange, RecuperarRequest, RestablecerRequest

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


@router.put("/password")
def cambiar_contraseña(
    datos: PasswordChange,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_admin),
):
    """Cambio de contraseña del dueño LOGUEADO (spec deploy §4b):
    verifica la actual con bcrypt -> guarda el nuevo hash. La nueva exige
    >= 8 caracteres. La respuesta es simple: {"ok": true}.
    (require_admin entrega el AdminUser de la MISMA sesión get_db: acá se
    persiste el cambio con commit.)"""
    if len(datos.password_nueva) < 8:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 8 caracteres")
    if not verify_password(datos.password_actual, admin.password_hash):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
    admin.password_hash = hash_password(datos.password_nueva)
    db.commit()
    return {"ok": True}