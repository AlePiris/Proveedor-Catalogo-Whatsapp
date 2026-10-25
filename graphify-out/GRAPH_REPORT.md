# Graph Report - El-Gordito  (2026-10-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 599 nodes · 1315 edges · 30 communities (19 shown, 11 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 76 edges (avg confidence: 0.93)
- Token cost: 19,110 input · 1,686 output

## Graph Freshness
- Built from commit: `c7257824`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Frontend API Client
- Product & Combo Models
- Pydantic API Schemas
- Order Management
- Docker Compose Setup
- Frontend Dependencies
- Project Docs & Deploy
- Admin Authentication
- Order Tests & Security
- Admin Combos & Gallery UI
- Backend Core Config
- TypeScript Config
- Test Fixtures & Migrations
- FastAPI Routers Setup
- Gallery Image Tests
- Category CRUD
- Order Admin Panel
- Product Admin Panel
- Combo Stock Tests
- Sales Analytics
- Store Config Endpoints
- CORS Settings Parsing
- Health Check
- Vite Env Types

## God Nodes (most connected - your core abstractions)
1. `Producto` - 29 edges
2. `ESTADO-PROYECTO.md — Estado del proyecto El Gordito` - 27 edges
3. `react` - 19 edges
4. `compilerOptions` - 18 edges
5. `docs/base-de-datos.md — documentación de la base de datos` - 18 edges
6. `_crear_pedido()` - 17 edges
7. `Spec: deploy a producción (Vercel + Neon + Blob) y credenciales` - 17 edges
8. `Pedido` - 15 edges
9. `api` - 15 edges
10. `Plan de implementación: subsistema de tests del backend` - 15 edges

## Surprising Connections (you probably didn't know these)
- `docs/Colores.jpg — Lista de precios Vitalgy Cereal Bar (PDF del proveedor)` ----> `ESTADO-PROYECTO.md — Estado del proyecto El Gordito`  [AMBIGUOUS]
  docs/Colores.jpg → ESTADO-PROYECTO.md
- `ESTADO-PROYECTO.md — Estado del proyecto El Gordito` ----> `Stock efectivo de combos`  [INFERRED]
  ESTADO-PROYECTO.md → docs/base-de-datos.md
- `docs/Colores.jpg — Lista de precios Vitalgy Cereal Bar (PDF del proveedor)` ----> `Catálogo de proveedor (hoy PDF por WhatsApp)`  [INFERRED]
  docs/Colores.jpg → ESTADO-PROYECTO.md
- `README.md — Proveedor Web (Trabajo Integrador)` ----> `frontend/index.html — entry HTML de Vite/React`  [INFERRED]
  README.md → frontend/index.html
- `docs/estrategia-plantilla.md — El Gordito como plantilla comercial` ----> `Stack de deploy: Vercel + Neon + Vercel Blob`  [INFERRED]
  docs/estrategia-plantilla.md → ESTADO-PROYECTO.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flujo de pedido: carrito → WhatsApp + pedidos pendientes** — whatsapp_checkout_flow, frontend_src_context_cartcontext, backend_routers_pedidos, db_pedidos, db_pedido_items [EXTRACTED 0.90]
- **Deploy: Vercel front + Vercel serverless + Neon + Blob** — vercel_neon_deploy, vercel_blob, backend_vercel_json, backend_app_database, backend_app_emails [EXTRACTED 0.90]
- **Modelo relacional de El Gordito: 8 tablas del ORM** — db_productos, db_producto_imagenes, db_combo_items, db_pedidos, db_pedido_items, db_categorias, db_admin_users, db_local_config, backend_app_models [EXTRACTED 1.00]
- **Suite de tests del backend (pytest)** — backend_tests_conftest, backend_tests_test_salud, backend_tests_test_galeria, backend_tests_test_combos, backend_tests_test_pedidos, backend_requirements_dev, backend_pyproject, docs_superpowers_specs_2026_09_24_backend_tests_design, docs_superpowers_plans_2026_09_24_backend_tests [EXTRACTED 1.00]

## Communities (30 total, 11 thin omitted)

### Community 0 - "Frontend API Client"
Cohesion: 0.07
Nodes (65): api, clearToken(), getToken(), request(), setToken(), App(), Footer(), Navbar() (+57 more)

### Community 1 - "Product & Combo Models"
Cohesion: 0.06
Nodes (27): ComboItem, Producto, ProductoImagen, _aplicar_stock_combos(), borrar_combo(), borrar_imagen(), borrar_producto(), cambiar_activo() (+19 more)

### Community 2 - "Pydantic API Schemas"
Cohesion: 0.06
Nodes (21): CategoriaCreate, CategoriaOut, CategoriaUpdate, ComboItemIn, ComboItemOut, ConfigOut, ConfigUpdate, EleccionCreate (+13 more)

### Community 3 - "Order Management"
Cohesion: 0.11
Nodes (18): Pedido, PedidoItem, _ajustar_stock(), cancelar_pedido(), confirmar_pedido(), _construir_items(), _consumo_combo(), crear_pedido() (+10 more)

### Community 4 - "Docker Compose Setup"
Cohesion: 0.06
Nodes (33): build, depends_on, environment, ports, condition, environment, healthcheck, image (+25 more)

### Community 5 - "Frontend Dependencies"
Cohesion: 0.08
Nodes (30): dependencies, react@^18.3.1, react-dom@^18.3.1, react-router-dom@^6.26.0, devDependencies, autoprefixer@^10.4.19, postcss@^8.4.39, tailwindcss@^3.4.7 (+22 more)

### Community 6 - "Project Docs & Deploy"
Cohesion: 0.12
Nodes (32): backend/app/emails.py — envío de email (SMTP, módulo nuevo), backend/app/routers/ — productos, pedidos, analisis, auth, .env.example — placeholders de variables (comiteado), backend/app/routers/pedidos.py — creación/edición de pedidos, _movimientos_stock, backend/app/routers/productos.py — CRUD productos, galería, _stock_combo_efectivo, backend/vercel.json — config mínima para el backend serverless, Stock efectivo de combos, Tabla admin_users (login del dueño) (+24 more)

### Community 7 - "Admin Authentication"
Cohesion: 0.11
Nodes (10): crear_token(), get_admin_actual(), hash_password(), verify_password(), AdminUser, Categoria, LocalConfig, login() (+2 more)

### Community 8 - "Order Tests & Security"
Cohesion: 0.15
Nodes (17): _crear_pedido(), _stock(), test_admin_editar_agrega_item_manual_sin_producto(), test_admin_editar_negocia_precio_del_catalogo(), test_cancelar_reintegra_el_stock(), test_confirmar_fija_estado(), test_crear_pedido_snapshot_y_descuento(), test_delivery_sin_direccion_400() (+9 more)

### Community 9 - "Admin Combos & Gallery UI"
Cohesion: 0.15
Nodes (17): AdminGaleriaImagenes(), AdminComboCard(), capitalizar(), Combos(), agregarFijo(), agregarGrupo(), crearCombo(), EditorComponentes() (+9 more)

### Community 10 - "Backend Core Config"
Cohesion: 0.16
Nodes (9): backend/pyproject.toml — config de pytest (testpaths, pythonpath), backend/requirements.txt — dependencias de producción, backend/requirements-dev.txt — dependencias de tests, Plan de implementación: subsistema de tests del backend, Spec: diseño del subsistema de tests del backend, ESTADO-PROYECTO.md — Estado del proyecto El Gordito, Autenticación admin: bcrypt + JWT + require_admin, Aislamiento de tests: SQLite en memoria + StaticPool (+1 more)

### Community 11 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleResolution (+11 more)

### Community 12 - "Test Fixtures & Migrations"
Cohesion: 0.13
Nodes (8): _columnas_existentes(), main(), cliente(), combo_armado(), crear_producto(), _crear(), engine(), uploads_dir()

### Community 14 - "Gallery Image Tests"
Cohesion: 0.23
Nodes (9): _subir(), test_archivos_fisicos_viven_y_mueren_con_las_filas(), test_borrar_principal_promueve_siguiente(), test_borrar_unica_imagen_deja_sin_principal(), test_endpoints_admin_sin_token_401(), test_marcar_principal_reordena(), test_subir_primera_imagen_pasa_a_ser_principal(), test_subir_producto_inexistente_404() (+1 more)

### Community 15 - "Category CRUD"
Cohesion: 0.15
Nodes (4): actualizar_categoria(), borrar_categoria(), crear_categoria(), listar_categorias()

### Community 16 - "Order Admin Panel"
Cohesion: 0.24
Nodes (8): GestionPedidos(), cancelar(), cargar(), confirmar(), guardarEdicion(), leerCantidad(), leerPrecio(), PedidoCard()

### Community 17 - "Product Admin Panel"
Cohesion: 0.35
Nodes (11): GestionProductos(), borrar(), borrarCategoria(), cargar(), cargarCategorias(), crear(), crearCategoria(), editar() (+3 more)

### Community 18 - "Combo Stock Tests"
Cohesion: 0.31
Nodes (5): _ids_admin(), _ids_publicos(), test_combo_agotado_desaparece_del_publico(), test_combo_desactivado_no_aparece_publico(), test_producto_simple_sin_stock_oculto()

### Community 20 - "Store Config Endpoints"
Cohesion: 0.25
Nodes (3): actualizar_config(), obtener_config(), _obtener_fila()

## Ambiguous Edges - Review These
- `ESTADO-PROYECTO.md — Estado del proyecto El Gordito` → `docs/Colores.jpg — Lista de precios Vitalgy Cereal Bar (PDF del proveedor)`  [AMBIGUOUS]
  docs/Colores.jpg · relation: unknown
- `Imágenes en Vercel Blob (helper guardar_archivo por entorno)` → `Galería multi-imagen de productos`  [AMBIGUOUS]
  docs/base-de-datos.md · relation: unknown

## Knowledge Gaps
- **6 isolated node(s):** `Estrategia plantilla: un repo, N despliegues`, `backend/pyproject.toml — config de pytest (testpaths, pythonpath)`, `backend/app/emails.py — envío de email (SMTP, módulo nuevo)`, `backend/vercel.json — config mínima para el backend serverless`, `frontend/src/components/Modal.tsx — ConfirmModal/ModalInput (nuevo)` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 237 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ESTADO-PROYECTO.md — Estado del proyecto El Gordito` connect `Backend Core Config` to `Frontend API Client`, `Pydantic API Schemas`, `Project Docs & Deploy`, `Admin Authentication`, `FastAPI Routers Setup`?**
  _High betweenness centrality (0.230) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `Producto` (e.g. with `actualizar_categoria()` and `borrar_categoria()`) actually correct?**
  _`Producto` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Estrategia plantilla: un repo, N despliegues`, `backend/pyproject.toml — config de pytest (testpaths, pythonpath)`, `backend/app/emails.py — envío de email (SMTP, módulo nuevo)` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend API Client` be split into smaller, more focused modules?**
  _Cohesion score 0.06794783802333562 - nodes in this community are weakly interconnected._
- **Why does `Plan de implementación: subsistema de tests del backend` connect `Backend Core Config` to `Project Docs & Deploy`, `Admin Authentication`, `Order Tests & Security`, `FastAPI Routers Setup`, `Gallery Image Tests`, `Combo Stock Tests`, `Smoke Tests`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `ESTADO-PROYECTO.md — Estado del proyecto El Gordito` and `docs/Colores.jpg — Lista de precios Vitalgy Cereal Bar (PDF del proveedor)`?**
  _Edge tagged AMBIGUOUS (relation: related to) - confidence is low._
- **What is the exact relationship between `Imágenes en Vercel Blob (helper guardar_archivo por entorno)` and `Galería multi-imagen de productos`?**
  _Edge tagged AMBIGUOUS (relation: related to) - confidence is low._