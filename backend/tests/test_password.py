"""
Tests del cambio de contraseña del dueño logueado (spec deploy §4b).

Reglas que fijan:
  - Con la actual correcta y una nueva >= 8: 200, y el LOGIN pasa a funcionar
    con la nueva y DEJA de funcionar con la vieja.
  - Password actual incorrecta -> 400 (nunca 500).
  - Password nueva con menos de 8 caracteres -> 400.
  - Sin token -> 401.
"""


def _cambiar(cliente, admin_headers, actual, nueva):
    return cliente.put(
        "/api/auth/password",
        json={"password_actual": actual, "password_nueva": nueva},
        headers=admin_headers,
    )


def test_cambio_correcto_y_login_con_la_nueva(cliente, admin_headers):
    resp = _cambiar(cliente, admin_headers, "secreto123", "nueva-secreta-999")
    assert resp.status_code == 200, resp.text

    # La vieja ya no loguea; la nueva sí.
    login = lambda pw: cliente.post(
        "/api/auth/login", json={"username": "tester", "password": pw}
    )
    assert login("secreto123").status_code == 401
    assert login("nueva-secreta-999").status_code == 200


def test_password_actual_incorrecta_400(cliente, admin_headers):
    resp = _cambiar(cliente, admin_headers, "no-es-mi-password", "nueva-secreta-999")
    assert resp.status_code == 400
    # Tras el rechazo, la vieja SIGUE logueando (no se cambió nada).
    assert cliente.post(
        "/api/auth/login", json={"username": "tester", "password": "secreto123"}
    ).status_code == 200


def test_password_nueva_corta_400(cliente, admin_headers):
    # "corta13" = 7 caracteres: la regla es >= 8 (spec §4b).
    resp = _cambiar(cliente, admin_headers, "secreto123", "corta13")
    assert resp.status_code == 400
    # Tras el rechazo la vieja sigue siendo válida (no se cambió a medias).
    assert cliente.post(
        "/api/auth/login", json={"username": "tester", "password": "secreto123"}
    ).status_code == 200


def test_sin_token_401(cliente):
    resp = cliente.put(
        "/api/auth/password",
        json={"password_actual": "secreto123", "password_nueva": "nueva-secreta-999"},
    )
    assert resp.status_code == 401