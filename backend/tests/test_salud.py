"""
Smoke tests del ARNÉS de test: si algo de acá falla, el problema es de
conftest.py (base, override, auth), no de la app. Validan el circuito
completo antes de escribir tests de negocio.
"""


def test_health_responde_ok(cliente):
    resp = cliente.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_admin_token_valido_accede(cliente, admin_headers):
    resp = cliente.get("/api/productos/admin", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json() == []