"""
Tests del logo del local (feature de Ajustes: el dueño sube una imagen y la
web la muestra en Navbar/Footer SIN logo si no hay imagen).

Regla que fijan: la IMAGEN ES EL INTERRUPTOR. No hay toggle aparte:
  - logo_url == ""  ->  no hay logo (el GET público lo devuelve vacío)
  - logo_url con ruta -> hay logo; subir una nueva REEMPLAZA la anterior
    (sin huérfanos en disco) y borrarla limpia archivo + URL de una vez.

PNG mínimo: la validación del endpoint es por content_type (image/*); el
contenido alcanza con una cabecera no vacía (mismo criterio que test_galeria).
"""

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _subir_logo(cliente, admin_headers, nombre="logo.png"):
    return cliente.post(
        "/api/config/logo",
        files={"archivo": (nombre, PNG, "image/png")},
        headers=admin_headers,
    )


def test_sin_logo_el_get_publico_trae_vacio(cliente):
    """Sin acciones previas, el GET público devuelve logo_url vacío (el
    frontend muestra solo el nombre, como siempre)."""
    assert cliente.get("/api/config").json()["logo_url"] == ""


def test_subir_logo_guarda_url_y_archivo(cliente, admin_headers, uploads_dir):
    resp = _subir_logo(cliente, admin_headers)
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    assert cuerpo["logo_url"].startswith("/uploads/logo_")

    # El archivo físico existe en el directorio de uploads (temporal).
    nombre = cuerpo["logo_url"].rsplit("/", 1)[-1]
    assert (uploads_dir / nombre).is_file()

    # El GET público ya lo ve (el frontend no depende del cuerpo del POST).
    assert cliente.get("/api/config").json()["logo_url"] == cuerpo["logo_url"]


def test_subir_segundo_logo_reemplaza_al_anterior(cliente, admin_headers, uploads_dir):
    primera = _subir_logo(cliente, admin_headers).json()["logo_url"]
    segunda = _subir_logo(cliente, admin_headers).json()["logo_url"]
    assert segunda != primera
    # El archivo del logo anterior se borró: quedan huérfanos en disco, no.
    assert len(list(uploads_dir.glob("logo_*"))) == 1
    assert cliente.get("/api/config").json()["logo_url"] == segunda


def test_subir_no_imagen_rechazado(cliente, admin_headers):
    resp = cliente.post(
        "/api/config/logo",
        files={"archivo": ("datos.txt", b"hola", "text/plain")},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_borrar_logo_limpia_url_y_archivo(cliente, admin_headers, uploads_dir):
    _subir_logo(cliente, admin_headers)
    resp = cliente.delete("/api/config/logo", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["logo_url"] == ""
    assert cliente.get("/api/config").json()["logo_url"] == ""
    # Sin restos físicos en disco.
    assert len(list(uploads_dir.glob("logo_*"))) == 0


def test_borrar_logo_sin_logo_igual_200(cliente, admin_headers):
    """Borrar sin haber subido nada NO es un error: el estado final pedido
    (sin logo) ya es la realidad."""
    resp = cliente.delete("/api/config/logo", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["logo_url"] == ""


def test_endpoints_del_logo_sin_token_401(cliente):
    assert cliente.post(
        "/api/config/logo", files={"archivo": ("logo.png", PNG, "image/png")}
    ).status_code == 401
    assert cliente.delete("/api/config/logo").status_code == 401


def test_config_update_acepta_logo_url_vacio(cliente, admin_headers, uploads_dir):
    """PUT /api/config también puede limpiar el campo (ruta alternativa al
    DELETE); el frontend usa el DELETE porque además borra el archivo."""
    _subir_logo(cliente, admin_headers)
    resp = cliente.put("/api/config", json={"logo_url": ""}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["logo_url"] == ""