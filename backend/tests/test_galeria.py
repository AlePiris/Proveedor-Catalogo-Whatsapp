"""
Tests de la galería de imágenes (endpoints admin de /api/productos).

Regla que fijan (spec, sección "Enfoque A"): `productos.imagen_url` es la
PRINCIPAL (denormalizada; la leen cards, carrusel y carrito) y
`producto_imagenes` es la fuente de verdad de la GALERÍA. Toda la
sincronización entre ambas vive en el router; estos tests la pinnean.
"""

# PNG mínimo: la validación del endpoint es por content_type (image/*); el
# contenido alcanza con una cabecera no vacía.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _subir(cliente, admin_headers, producto_id, nombre="foto.png"):
    """Sube una imagen PNG de test al producto. Devuelve la respuesta."""
    return cliente.post(
        f"/api/productos/{producto_id}/imagen",
        files={"archivo": (nombre, PNG, "image/png")},
        headers=admin_headers,
    )


def test_subir_primera_imagen_pasa_a_ser_principal(cliente, admin_headers, crear_producto):
    p = crear_producto()
    resp = _subir(cliente, admin_headers, p["id"])
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo["imagenes"]) == 1
    assert cuerpo["imagenes"][0]["orden"] == 0
    # La primera subida es también la principal (la que ven las cards).
    assert cuerpo["imagen_url"] == cuerpo["imagenes"][0]["url"]


def test_subir_segunda_no_roba_la_principal(cliente, admin_headers, crear_producto):
    p = crear_producto()
    primera = _subir(cliente, admin_headers, p["id"]).json()
    segunda = _subir(cliente, admin_headers, p["id"]).json()
    assert len(segunda["imagenes"]) == 2
    # Append a la galería: la principal sigue siendo la primera.
    assert segunda["imagen_url"] == primera["imagen_url"]
    assert segunda["imagenes"][1]["orden"] == 1


def test_subir_no_imagen_rechazado(cliente, admin_headers, crear_producto):
    p = crear_producto()
    resp = cliente.post(
        f"/api/productos/{p['id']}/imagen",
        files={"archivo": ("datos.txt", b"hola", "text/plain")},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_subir_producto_inexistente_404(cliente, admin_headers):
    assert _subir(cliente, admin_headers, 999999).status_code == 404


def test_marcar_principal_reordena(cliente, admin_headers, crear_producto):
    p = crear_producto()
    _subir(cliente, admin_headers, p["id"])
    segunda = _subir(cliente, admin_headers, p["id"]).json()["imagenes"][1]
    resp = cliente.patch(
        f"/api/productos/{p['id']}/imagen/{segunda['id']}/principal",
        headers=admin_headers,
    )
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["imagen_url"] == segunda["url"]
    # Renumera el orden completo: la elegida queda 0 y el resto la sigue.
    assert [i["orden"] for i in cuerpo["imagenes"]] == [0, 1]


def test_borrar_principal_promueve_siguiente(cliente, admin_headers, crear_producto):
    p = crear_producto()
    _subir(cliente, admin_headers, p["id"])
    cuerpo = _subir(cliente, admin_headers, p["id"]).json()
    principal, segunda = cuerpo["imagenes"]
    resp = cliente.delete(
        f"/api/productos/{p['id']}/imagen/{principal['id']}", headers=admin_headers
    )
    assert resp.status_code == 204
    detalle = cliente.get(f"/api/productos/{p['id']}").json()
    assert detalle["imagen_url"] == segunda["url"]


def test_borrar_unica_imagen_deja_sin_principal(cliente, admin_headers, crear_producto):
    p = crear_producto()
    cuerpo = _subir(cliente, admin_headers, p["id"]).json()
    resp = cliente.delete(
        f"/api/productos/{p['id']}/imagen/{cuerpo['imagenes'][0]['id']}",
        headers=admin_headers,
    )
    assert resp.status_code == 204
    detalle = cliente.get(f"/api/productos/{p['id']}").json()
    assert detalle["imagen_url"] is None
    assert detalle["imagenes"] == []


def test_borrar_imagen_inexistente_404(cliente, admin_headers, crear_producto):
    p = crear_producto()
    resp = cliente.delete(f"/api/productos/{p['id']}/imagen/999999", headers=admin_headers)
    assert resp.status_code == 404


def test_archivos_fisicos_viven_y_mueren_con_las_filas(
    cliente, admin_headers, crear_producto, uploads_dir
):
    p = crear_producto()
    cuerpo = _subir(cliente, admin_headers, p["id"]).json()
    # El archivo físico existe en el directorio de uploads (temporal).
    assert len(list(uploads_dir.glob(f"{p['id']}_*"))) == 1
    # Se borra junto con la fila (no quedan huérfanos en disco).
    cliente.delete(
        f"/api/productos/{p['id']}/imagen/{cuerpo['imagenes'][0]['id']}",
        headers=admin_headers,
    )
    assert len(list(uploads_dir.glob(f"{p['id']}_*"))) == 0
    # Borrar el PRODUCTO limpia todos sus archivos de una vez.
    _subir(cliente, admin_headers, p["id"])
    _subir(cliente, admin_headers, p["id"])
    cliente.delete(f"/api/productos/{p['id']}", headers=admin_headers)
    assert len(list(uploads_dir.glob(f"{p['id']}_*"))) == 0


def test_endpoints_admin_sin_token_401(cliente, crear_producto):
    p = crear_producto()
    assert cliente.get("/api/productos/admin").status_code == 401
    assert _subir(cliente, {}, p["id"]).status_code == 401
    # Con un token basura también es 401 (JWT mal formado, no 500).
    resp = _subir(cliente, {"Authorization": "Bearer no-es-un-token"}, p["id"])
    assert resp.status_code == 401