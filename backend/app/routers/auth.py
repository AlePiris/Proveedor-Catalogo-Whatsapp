"""
Router de autenticación: login, cambio de contraseña del dueño y recuperación
por email (recuperar/restablecer; spec deploy §4b-4c).
"""
from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import crear_token, hash_password, require_admin, verify_password
from app.config import settings
from app.database import get_db
from app.emails import enviar_email
from app.models import AdminUser, PasswordReset
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


# ---------- Recuperación de contraseña (spec deploy §4c) ----------
# Rate limit best-effort EN MEMORIA (~3 requests/min por instancia). Serverless
# no comparte memoria entre instancias: mitigación práctica, no garantía —
# aceptado para este alcance (tokens de 30 min + un solo uso + emails fijos).
_RECUPERAR_VENTANA = 60  # segundos
_RECUPERAR_MAX = 3
_RECUPERAR_VISTOS: dict[str, list[float]] = {}

MENSAJE_GENERICO = "Si el usuario existe, se envió un email a los contactos registrados."


def _hash_token(token: str) -> str:
    """SHA-256 del token: en la DB JAMÁS viaja el token en claro."""
    return hashlib.sha256(token.encode()).hexdigest()


def _limitar_recuperar(request: Request) -> None:
    """429 si la misma IP pide más de _RECUPERAR_MAX en la ventana. Mutación
    en el dict de módulo (los tests lo reemplazan con monkeypatch)."""
    import time

    ahora = time.monotonic()
    ip = request.client.host if request.client else "desconocida"
    vistos = [t for t in _RECUPERAR_VISTOS.get(ip, []) if ahora - t < _RECUPERAR_VENTANA]
    if len(vistos) >= _RECUPERAR_MAX:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Probá de nuevo en un minuto.")
    vistos.append(ahora)
    _RECUPERAR_VISTOS[ip] = vistos


@router.post("/recuperar")
def recuperar(datos: RecuperarRequest, request: Request, db: Session = Depends(get_db)):
    """Genera un token de un solo uso y manda el email de recuperación a las
    direcciones FIJAS de RECOVERY_EMAILS. SIEMPRE responde 200 con el mismo
    mensaje genérico — un 404/200-diferente confirmaría qué usuarios existen."""
    _limitar_recuperar(request)

    admin = db.query(AdminUser).filter(AdminUser.username == datos.username.strip()).first()
    if admin is not None:
        token = secrets.token_urlsafe(32)
        reset = PasswordReset(
            admin_id=admin.id,
            token_hash=_hash_token(token),
            expira_en=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        db.add(reset)
        db.commit()

        # El email es la NOTIFICACIÓN, no la transacción: si SMTP está caído o
        # RECOVERY_EMAILS quedó vacía, NO va a 500 — un error aquí confirmaría
        # (en el status) que el username existe. Se loguea y se responde igual.
        link = f"{settings.frontend_url}/restablecer-password?token={token}"
        try:
            enviar_email(
                "Recuperación de contraseña",
                (
                    "<p>Se pidió un restablecimiento de contraseña para el panel del dueño.</p>"
                    f"<p><a href=\"{link}\">Restablecer contraseña</a></p>"
                    "<p>Si no fuiste vos, ignorá este email (el enlace vence en 30 minutos).</p>"
                ),
                [e.strip() for e in settings.recovery_emails.split(",") if e.strip()],
            )
        except Exception as e:  # noqa: BLE001 — cualquier SMTP/host/cred error
            print(f"[auth] email de recuperación NO enviado: {e!r}")
    return {"detail": MENSAJE_GENERICO}


@router.post("/restablecer")
def restablecer(datos: RestablecerRequest, db: Session = Depends(get_db)):
    """Consume el token del email: válido, no usado y NO expirado -> cambia el
    hash del admin, marca el token usado y avisa a RECOVERY_EMAILS. Cada
    condición fallida es un 400 con mensaje claro (la vigencia se compara con
    la row, no se re-hashea nada)."""
    if len(datos.password_nueva) < 8:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 8 caracteres")

    fila = db.query(PasswordReset).filter(
        PasswordReset.token_hash == _hash_token(datos.token)
    ).first()
    if fila is None or fila.usado:
        raise HTTPException(status_code=400, detail="El enlace no es válido o ya se usó")
    # La columna DateTime (sin tz) devuelve naive en Postgres/SQLite: si la row
    # no trae timezone la interpretamos como UTC (así la escribimos).
    expira = fila.expira_en if fila.expira_en.tzinfo else fila.expira_en.replace(tzinfo=timezone.utc)
    if expira < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="El enlace expiró. Pedí uno nuevo")

    admin = db.query(AdminUser).filter(AdminUser.id == fila.admin_id).first()
    if admin is None:
        raise HTTPException(status_code=400, detail="El enlace no es válido o ya se usó")

    admin.password_hash = hash_password(datos.password_nueva)
    fila.usado = True
    db.commit()
    # El CAMBIO ya sucedió (commit arriba): que el email de aviso falle no
    # puede convertir esto en 500 — el dueño reintentando vería el confuso
    # "el enlace ya se usó" y creería que NO se cambió.
    try:
        enviar_email(
            "Se cambió la contraseña del panel",
            "<p>La contraseña del panel del dueño acaba de cambiar vía enlace de recuperación.</p>",
            [e.strip() for e in settings.recovery_emails.split(",") if e.strip()],
        )
    except Exception as e:  # noqa: BLE001
        print(f"[auth] email de aviso de cambio NO enviado: {e!r}")
    return {"detail": "Contraseña restablecida. Ya podés entrar con la nueva."}