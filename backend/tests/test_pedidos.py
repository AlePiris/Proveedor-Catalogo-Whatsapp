"""
Tests del ciclo de vida de pedidos: precios snapshot que fija el BACKEND,
descuento de stock al crear, reintegro al cancelar/editar y validación de
las elecciones de grupos de combos.

Contratos que pinnean (routers/pedidos.py):
  - El total lo calcula SIEMPRE el backend desde el precio vigente.
  - El stock se descuenta al CREAR y se reintegra al CANCELAR/EDITAR.
  - Las elecciones de un grupo deben sumar EXACTO N (400 si no).

OJO serialización: FastAPI+Pydantic v2 devuelven los Decimal como STRING
("2000.00"), no como número. Las aserciones monetarias comparan con
Decimal(...) — es la forma honesta de comparar dinero (sin floats).
"""
from decimal import Decimal


def _crear_pedido(cliente, items, **extras):
    """POST público /api/pedidos. extras pisa campos del body (tipo_entrega,
    metodo_pago, etc.)."""
    datos = {"cliente_nombre": "Cliente test", "items": items}
    datos.update(extras)
    return cliente.post("/api/pedidos", json=datos)


def _stock(cliente, producto_id):
    """Stock actual del producto según el endpoint público de detalle."""
    return cliente.get(f"/api/productos/{producto_id}").json()["stock"]


def test_crear_pedido_snapshot_y_descuento(cliente, crear_producto):
    p = crear_producto(precio=1000, stock=10)
    resp = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 2}])
    assert resp.status_code == 201
    cuerpo = resp.json()
    assert cuerpo["estado"] == "pendiente"
    # El precio lo decide el BACKEND (snapshot), no lo que mande el cliente.
    assert Decimal(cuerpo["items"][0]["precio_unitario"]) == 1000
    assert Decimal(cuerpo["total"]) == 2000
    assert _stock(cliente, p["id"]) == 8  # descontado al crear


def test_precio_de_oferta_se_aplica_al_snapshot(cliente, admin_headers, crear_producto):
    p = crear_producto(precio=1000, stock=5)
    cliente.patch(
        f"/api/productos/{p['id']}/oferta",
        json={"en_oferta": True, "precio_oferta": 800},
        headers=admin_headers,
    )
    resp = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 1}])
    assert Decimal(resp.json()["items"][0]["precio_unitario"]) == 800


def test_pedido_mas_stock_del_disponible_409(cliente, crear_producto):
    p = crear_producto(stock=10)
    resp = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 11}])
    assert resp.status_code == 409
    # El stock quedó intacto: la validación corre ANTES de mover nada.
    assert _stock(cliente, p["id"]) == 10


def test_pedido_combo_descuenta_las_elecciones(cliente, combo_armado):
    c = combo_armado
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": c["combo"]["id"],
                "cantidad": 1,
                "elecciones": [
                    {"grupo": "Empanada", "producto_id": c["carne"], "cantidad": 3},
                    {"grupo": "Empanada", "producto_id": c["queso"], "cantidad": 3},
                    {"grupo": "Bebida", "producto_id": c["coca"], "cantidad": 1},
                ],
            }
        ],
    )
    assert resp.status_code == 201, resp.text
    # El total es el PRECIO del combo (el de las opciones es descriptivo).
    assert resp.json()["total"] == c["combo"]["precio"]
    # Se descuenta lo elegido (3 Carne + 3 Queso), no 6 de cada una.
    assert _stock(cliente, c["carne"]) == 27
    assert _stock(cliente, c["queso"]) == 7
    assert _stock(cliente, c["coca"]) == 4
    assert _stock(cliente, c["agua"]) == 20  # no elegida: intacta
    assert _stock(cliente, c["postre"]) == 3  # el fijo siempre entra


def test_elecciones_que_no_suman_el_grupo_400(cliente, combo_armado):
    c = combo_armado
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": c["combo"]["id"],
                "cantidad": 1,
                # El grupo Empanada tiene 6 lugares y solo se eligen 3.
                "elecciones": [
                    {"grupo": "Empanada", "producto_id": c["carne"], "cantidad": 3},
                    {"grupo": "Bebida", "producto_id": c["coca"], "cantidad": 1},
                ],
            }
        ],
    )
    assert resp.status_code == 400


def test_eleccion_de_producto_que_no_es_opcion_400(cliente, combo_armado):
    c = combo_armado
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": c["combo"]["id"],
                "cantidad": 1,
                # El postre es componente FIJO, no opción del grupo Empanada.
                "elecciones": [
                    {"grupo": "Empanada", "producto_id": c["postre"], "cantidad": 6},
                    {"grupo": "Bebida", "producto_id": c["coca"], "cantidad": 1},
                ],
            }
        ],
    )
    assert resp.status_code == 400


def test_producto_simple_rechaza_elecciones(cliente, crear_producto):
    p = crear_producto()
    resp = _crear_pedido(
        cliente,
        [
            {
                "producto_id": p["id"],
                "cantidad": 1,
                "elecciones": [
                    {"grupo": "Inexistente", "producto_id": p["id"], "cantidad": 1}
                ],
            }
        ],
    )
    assert resp.status_code == 400


def test_pedido_publico_rechaza_item_manual(cliente, crear_producto):
    """SEGURIDAD: el POST público NO acepta ítems sin producto_id. Si los
    aceptara, cualquiera armaría desde afuera un pedido con el precio que
    quiera (ej: una docena de empanadas a $50). La vía "a mano" existe SOLO
    para el dueño, vía PUT admin (ver test_admin_editar_agrega_item_manual).
    """
    p = crear_producto()
    resp = _crear_pedido(
        cliente,
        [
            {"producto_id": p["id"], "cantidad": 1},
            {
                "producto_id": None,
                "nombre": "Docena trucho",
                "precio_unitario": 50,
                "cantidad": 1,
            },
        ],
    )
    assert resp.status_code == 400


def test_delivery_sin_direccion_400(cliente, crear_producto):
    p = crear_producto()
    resp = _crear_pedido(
        cliente, [{"producto_id": p["id"], "cantidad": 1}], tipo_entrega="delivery"
    )
    assert resp.status_code == 400


def test_metodo_pago_invalido_400(cliente, crear_producto):
    p = crear_producto()
    resp = _crear_pedido(
        cliente, [{"producto_id": p["id"], "cantidad": 1}], metodo_pago="dolares"
    )
    assert resp.status_code == 400


def test_cancelar_reintegra_el_stock(cliente, admin_headers, crear_producto):
    p = crear_producto(stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 4}]).json()
    assert _stock(cliente, p["id"]) == 6
    resp = cliente.patch(
        f"/api/admin/pedidos/{pedido['id']}/cancelar", headers=admin_headers
    )
    assert resp.status_code == 200
    assert resp.json()["estado"] == "cancelada"
    # Las unidades que no se vendieron vuelven a la venta.
    assert _stock(cliente, p["id"]) == 10


def test_confirmar_fija_estado(cliente, admin_headers, crear_producto):
    p = crear_producto(stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 1}]).json()
    resp = cliente.patch(
        f"/api/admin/pedidos/{pedido['id']}/confirmar", headers=admin_headers
    )
    assert resp.json()["estado"] == "confirmada"
    # Confirmado ya no se puede tocar: 400 controlado (no 500 ni silencio).
    resp = cliente.patch(
        f"/api/admin/pedidos/{pedido['id']}/cancelar", headers=admin_headers
    )
    assert resp.status_code == 400
    # EDITAR también pasa por el mismo contrato (solo pendiente): si alguien
    # "simplifica" editar_pedido sin el chequeo, este PUT lo pinta de rojo.
    resp = cliente.put(
        f"/api/admin/pedidos/{pedido['id']}",
        json={"items": [{"producto_id": p["id"], "cantidad": 5}]},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_editar_items_recalcula_total_y_diferencia_de_stock(
    cliente, admin_headers, crear_producto
):
    p = crear_producto(precio=1000, stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 4}]).json()
    assert _stock(cliente, p["id"]) == 6
    # El dueño ajusta el pedido por WhatsApp: ahora son 2 en vez de 4.
    resp = cliente.put(
        f"/api/admin/pedidos/{pedido['id']}",
        json={"items": [{"producto_id": p["id"], "cantidad": 2}]},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert Decimal(resp.json()["total"]) == 2000
    # Reintegró los 4 viejos y volvió a descontar los 2 nuevos: queda 8.
    assert _stock(cliente, p["id"]) == 8


def test_admin_editar_agrega_item_manual_sin_producto(cliente, admin_headers, crear_producto):
    """El ítem "Otro" (sin producto_id) es la vía del DUEÑO para sumar al
    pedido lo acordado por WhatsApp (un extra que no está en el menú).

    Este test fija ese lado PREVISTO del contrato. El POST público hoy
    también acepta ítems manuales sin chequeo de rol (hallazgo conocido,
    pendiente de decisión): cuando eso se arregle, este test define lo que
    el fix NO tiene que romper — editar como admin sigue pudiendo.
    """
    p = crear_producto(precio=1000, stock=10)
    pedido = _crear_pedido(cliente, [{"producto_id": p["id"], "cantidad": 1}]).json()
    resp = cliente.put(
        f"/api/admin/pedidos/{pedido['id']}",
        json={
            "items": [
                {"producto_id": p["id"], "cantidad": 1},
                {"producto_id": None, "nombre": "Bacon extra",
                 "precio_unitario": 500, "cantidad": 1},
            ]
        },
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    assert Decimal(cuerpo["total"]) == 1500  # 1000 del producto + 500 manual
    assert cuerpo["items"][1]["nombre"] == "Bacon extra"
    # El ítem manual no tiene stock asociado: el producto queda como estaba
    # tras el reemplazo (reintegró 1 y volvió a descontar 1).
    assert _stock(cliente, p["id"]) == 9