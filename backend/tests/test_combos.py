"""
Tests del stock EFECTIVO de combos y la visibilidad del catálogo público.

Regla que fijan (spec): el combo NO tiene stock propio; cuántos se pueden
armar sale de sus componentes (mínimo entre fijos y grupos, con las
unidades de un grupo SUMADAS). El catálogo público solo muestra lo
vendible; el admin lo ve todo.
"""


def _ids_publicos(cliente):
    """Ids de los productos que ve el CLIENTE (catálogo público)."""
    return {p["id"] for p in cliente.get("/api/productos").json()}


def _ids_admin(cliente, admin_headers):
    """Ids de TODOS los productos (los ocultos incluidos) para el dueño."""
    return {
        p["id"]
        for p in cliente.get("/api/productos/admin", headers=admin_headers).json()
    }


def test_stock_efectivo_es_el_minimo_de_componentes(cliente, combo_armado):
    detalle = cliente.get(f"/api/productos/{combo_armado['combo']['id']}").json()
    # El postre fijo (4) es el cuello de botella, aunque el grupo Empanada
    # alcance para 6 y el de Bebida para 25. Si las opciones de un grupo se
    # contaran como mínimo en vez de SUMA, daría 1 y este test fallaría.
    assert detalle["stock"] == 4
    assert detalle["disponible"] is True


def test_combo_agotado_desaparece_del_publico(cliente, admin_headers, combo_armado):
    combo_id = combo_armado["combo"]["id"]
    assert combo_id in _ids_publicos(cliente)  # sanity: arranca visible
    # Se agota el cuello de botella (postre fijo).
    cliente.put(
        f"/api/productos/{combo_armado['postre']}",
        json={"stock": 0},
        headers=admin_headers,
    )
    assert combo_id not in _ids_publicos(cliente)
    # El dueño lo sigue viendo en el admin (para reponer y reactivar).
    assert combo_id in _ids_admin(cliente, admin_headers)


def test_combo_desactivado_no_aparece_publico(cliente, admin_headers, combo_armado):
    combo_id = combo_armado["combo"]["id"]
    cliente.patch(
        f"/api/combos/{combo_id}/activo", json={"activo": False}, headers=admin_headers
    )
    assert combo_id not in _ids_publicos(cliente)
    assert combo_id in _ids_admin(cliente, admin_headers)


def test_producto_simple_sin_stock_oculto(cliente, admin_headers, crear_producto):
    p = crear_producto(stock=0)
    assert p["id"] not in _ids_publicos(cliente)
    # mostrar_sin_stock lo devuelve a vitrina (el dueño apagó la alarma).
    cliente.put(
        f"/api/productos/{p['id']}",
        json={"mostrar_sin_stock": True},
        headers=admin_headers,
    )
    assert p["id"] in _ids_publicos(cliente)