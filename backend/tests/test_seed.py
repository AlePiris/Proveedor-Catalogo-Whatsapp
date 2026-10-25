"""
Tests del seed sin hardcodeo (spec deploy §4a).

Reglas que fijan:
  - Sin ADMIN_USERNAME/ADMIN_PASSWORD las credenciales no se inventan: el seed
    corta con un error que NOMBRA la variable faltante, ANTES de conectarse a
    la DB (un seed en prod no debe abrir una sesión de más).
  - Con creds: el admin se crea con hash bcrypt verificable.
  - Idempotente: correrlo de nuevo no duplica ni REINICIA el password de un
    admin que ya existe (el dueño ya pudo haberlo cambiado).
"""
import pytest

from app.auth import verify_password
from app.config import settings
from app.models import AdminUser
from app.seed import crear_admin, main


@pytest.fixture()
def sesion_test(engine):
    from sqlalchemy.orm import sessionmaker
    from app.database import Base

    Base.metadata.create_all(bind=engine)
    S = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = S()
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)
    db.get_bind().dispose()


def test_main_sin_creds_corta_con_error_que_nombra_la_var(monkeypatch):
    monkeypatch.setattr(settings, "admin_username", "")
    monkeypatch.setattr(settings, "admin_password", "")
    with pytest.raises(SystemExit) as e:
        main()
    assert "ADMIN_USERNAME" in str(e.value)


def test_main_sin_password_corta_nominando_ADMIN_PASSWORD(monkeypatch):
    monkeypatch.setattr(settings, "admin_username", "dueño")
    monkeypatch.setattr(settings, "admin_password", "")
    with pytest.raises(SystemExit) as e:
        main()
    assert "ADMIN_PASSWORD" in str(e.value)


def test_crear_admin_crea_con_hash_verificable(sesion_test, monkeypatch):
    monkeypatch.setattr(settings, "admin_username", "dueño_test")
    monkeypatch.setattr(settings, "admin_password", "password-larga-123")
    crear_admin(sesion_test)
    fila = sesion_test.query(AdminUser).filter(AdminUser.username == "dueño_test").first()
    assert fila is not None
    assert fila.password_hash != "password-larga-123"  # NUNCA en claro
    assert verify_password("password-larga-123", fila.password_hash)


def test_crear_admin_idempotente(sesion_test, monkeypatch):
    monkeypatch.setattr(settings, "admin_username", "dueño_test")
    monkeypatch.setattr(settings, "admin_password", "primera-larga-123")
    crear_admin(sesion_test)
    hash_antes = sesion_test.query(AdminUser).filter(AdminUser.username == "dueño_test").first().password_hash

    # El humano ya pudo haber cambiado su password: correr el seed de nuevo no
    # la reinicia ni duplica el usuario.
    monkeypatch.setattr(settings, "admin_password", "otra-larga-456")
    crear_admin(sesion_test)
    filas = sesion_test.query(AdminUser).filter(AdminUser.username == "dueño_test").all()
    assert len(filas) == 1
    assert filas[0].password_hash == hash_antes