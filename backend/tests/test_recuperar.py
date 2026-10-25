"""
Tests de la recuperación de contraseña por email (spec deploy §4c).

Reglas que fijan:
  - POST /api/auth/recuperar SIEMPRE responde 200 con el MISMO mensaje
    genérico: nunca confirma si el usuario existe (enumeración de usuarios).
    El email va SOLO a RECOVERY_EMAILS (direcciones fijas de env).
  - El token vuela solo por email: en la DB queda SOLO su SHA-256.
  - POST /api/auth/restablecer: token válido + nueva >= 8 -> cambia la
    password (el login viejo muere); token usado/expirado/inexistente ->
    400. Un token sirve UNA vez.
  - El módulo emails.py se MOCKEA (los tests nunca envían emails de verdad).
  - Rate limit best-effort ~3/min por instancia -> 429 en la 4ª llamada.
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.models import PasswordReset

MENSAJE_GENERICO = "Si el usuario existe, se envió un email a los contactos registrados."


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@pytest.fixture()
def sesion(engine):
    """Sesión sobre EL MISMO engine de los fixtures cliente/admin_headers:
    permite leer filas de password_resets y crearlas a mano (expirado)."""
    from sqlalchemy.orm import sessionmaker

    S = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = S()
    yield db
    db.close()


@pytest.fixture()
def rate_limit_fresco(monkeypatch):
    """Rate limiter limpio: cada test arranca con su cuota de 3/min."""
    monkeypatch.setattr("app.routers.auth._RECUPERAR_VISTOS", {})


def _pedir(cliente, username: str):
    return cliente.post("/api/auth/recuperar", json={"username": username})


def test_recuperar_existente_envia_email_con_token(
    cliente, sesion, admin_headers, monkeypatch, rate_limit_fresco
):
    recibido: dict = {}

    def enviar_email_falso(asunto, cuerpo, destinatarios):
        recibido.update(asunto=asunto, cuerpo=cuerpo, destinatarios=destinatarios)

    monkeypatch.setattr("app.routers.auth.enviar_email", enviar_email_falso)
    monkeypatch.setattr(settings, "frontend_url", "https://web.example.com")
    monkeypatch.setattr(settings, "recovery_emails", "dueno@mail.com")

    resp = _pedir(cliente, "tester")
    assert resp.status_code == 200
    assert resp.json()["detail"] == MENSAJE_GENERICO

    # Email a las direcciones FIJAS, con el link armado con FRONTEND_URL.
    assert recibido["destinatarios"] == ["dueno@mail.com"]
    assert "https://web.example.com/restablecer-password?token=" in recibido["cuerpo"]
    token = re.search(r"token=([\w\-]+)", recibido["cuerpo"]).group(1)

    # En la DB queda SOLO el hash — nunca el token en claro.
    fila = sesion.query(PasswordReset).first()
    assert fila is not None
    assert fila.token_hash == _hash_token(token)
    assert token not in fila.token_hash


def test_recuperar_inexistente_mismo_mensaje_y_sin_email(
    cliente, monkeypatch, rate_limit_fresco
):
    llamadas: list = []
    monkeypatch.setattr(
        "app.routers.auth.enviar_email", lambda *a, **k: llamadas.append(1)
    )
    resp = _pedir(cliente, "usuario-que-no-existe")
    assert resp.status_code == 200
    assert resp.json()["detail"] == MENSAJE_GENERICO
    assert llamadas == []  # sin email para usernames inexistentes


def _usar_token(cliente, sesion, token, monkeypatch, nueva="nueva-secreta-888"):
    monkeypatch.setattr(settings, "admin_username", "tester")
    return cliente.post(
        "/api/auth/restablecer", json={"token": token, "password_nueva": nueva}
    )


def test_restablecer_token_valido_cambia_password(cliente, sesion, admin_headers, monkeypatch, rate_limit_fresco):
    pedidos: list = []
    monkeypatch.setattr("app.routers.auth.enviar_email", lambda a, c, d: pedidos.append(c))
    monkeypatch.setattr(settings, "frontend_url", "https://web.example.com")
    resp = _pedir(cliente, "tester")
    assert resp.status_code == 200
    token = re.search(r"token=([\w\-]+)", pedidos[0]).group(1)

    resp = _usar_token(cliente, sesion, token, monkeypatch)
    assert resp.status_code == 200, resp.text

    # La vieja ya no loguea; la nueva sí.
    viejo = cliente.post("/api/auth/login", json={"username": "tester", "password": "secreto123"})
    nuevo = cliente.post("/api/auth/login", json={"username": "tester", "password": "nueva-secreta-888"})
    assert viejo.status_code == 401
    assert nuevo.status_code == 200

    # El token quedó marcado usado: reusarlo ES 400.
    assert _usar_token(cliente, sesion, token, monkeypatch).status_code == 400


def test_restablecer_token_expirado_400(cliente, sesion, monkeypatch, rate_limit_fresco):
    fila = PasswordReset(admin_id=1, token_hash=_hash_token("tok-viejo"), expira_en=datetime.now(timezone.utc) - timedelta(minutes=1), usado=False)
    sesion.add(fila)
    sesion.commit()
    assert _usar_token(cliente, sesion, "tok-viejo", monkeypatch).status_code == 400


def test_restablecer_token_inexistente_400(cliente, sesion, monkeypatch, rate_limit_fresco):
    assert _usar_token(cliente, sesion, "tok-que-no-existe", monkeypatch).status_code == 400


def test_restablecer_terminos_usados_400(cliente, sesion, admin_headers, monkeypatch, rate_limit_fresco):
    pedidos: list = []
    monkeypatch.setattr("app.routers.auth.enviar_email", lambda a, c, d: pedidos.append(c))
    monkeypatch.setattr(settings, "frontend_url", "https://web.example.com")
    resp = _pedir(cliente, "tester")
    token = re.search(r"token=([\w\-]+)", pedidos[0]).group(1)
    assert _usar_token(cliente, sesion, token, monkeypatch, nueva="corta").status_code == 400
    # Tras el rechazo el token sigue usable (no quedó marcado usado).
    assert _usar_token(cliente, sesion, token, monkeypatch).status_code == 200


def test_recuperar_rate_limit_429(cliente, rate_limit_fresco):
    # 3 OK (genéricos) y la 4ª corta por rate limit (~3/min por instancia).
    for _ in range(3):
        assert _pedir(cliente, "tester").status_code == 200
    assert _pedir(cliente, "tester").status_code == 429


# ---------- Tolerancia a fallos de SMTP (review: Important #3) ----------

def test_recuperar_con_smtp_caido_sigue_200_generico(cliente, admin_headers, monkeypatch, rate_limit_fresco):
    """Si el envío falla (SMTP caído, credencial vencida), la respuesta NO es
    un 500: un error aquí confirmaría que el usuario existe. Se loguea y se
    responde lo genérico de siempre."""
    def smtp_caido(*a, **k):
        raise RuntimeError("SMTP caído")
    monkeypatch.setattr("app.routers.auth.enviar_email", smtp_caido)
    resp = _pedir(cliente, "tester")
    assert resp.status_code == 200
    assert resp.json()["detail"] == MENSAJE_GENERICO


def test_restablecer_con_smtp_caido_cambia_igual(cliente, sesion, admin_headers, monkeypatch, rate_limit_fresco):
    """El EMAIL de aviso es informativo: si falla DESPUÉS de cambiar la
    contraseña, el cambio ya sucedió — la respuesta es 200, no 500 (si no,
    el dueño reintenta el link y el 400 de "ya se usó" lo confunde)."""
    llamadas: list = []

    def enviar_segun_llamada(asunto, cuerpo, destinatarios):
        llamadas.append(cuerpo)  # guarda el cuerpo PARA SIEMPRE (aunque la 2ª explote)
        if len(llamadas) == 2:  # la 2ª es el aviso post-cambio: falla
            raise RuntimeError("SMTP caído")

    monkeypatch.setattr("app.routers.auth.enviar_email", enviar_segun_llamada)
    monkeypatch.setattr(settings, "frontend_url", "https://web.example.com")
    resp = _pedir(cliente, "tester")  # 1ª llamada (recuperar): OK
    assert resp.status_code == 200

    token = re.search(r"token=([\w\-]+)", llamadas[0]).group(1)
    resp2 = _usar_token(cliente, sesion, token, monkeypatch)
    assert resp2.status_code == 200, resp2.text  # el cambio SÍ sucedió

    # El cambio real sobrevivió al fallo del email: la nueva loguea y la vieja no.
    assert cliente.post("/api/auth/login", json={"username": "tester", "password": "nueva-secreta-888"}).status_code == 200
    assert cliente.post("/api/auth/login", json={"username": "tester", "password": "secreto123"}).status_code == 401