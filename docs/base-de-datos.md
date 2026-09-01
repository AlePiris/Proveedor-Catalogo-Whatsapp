# Base de datos — Pizzería El Gordito

Documentación de cómo está construida la base de datos del proyecto, qué
tecnologías usa y por qué se tomaron cada una de las decisiones de diseño.

---

## 1. Tecnologías

| Capa | Tecnología | Rol |
|---|---|---|
| Motor DB (desarrollo) | **SQLite 3** | Archivo local `backend/el-gordito.db`, cero configuración. Ideal para desarrollar en la notebook sin instalar nada. |
| Motor DB (producción) | **PostgreSQL** alojado en **Neon** | Base en la nube serverless. La app en Vercel se conecta por una URL (`DATABASE_URL`). |
| ORM | **SQLAlchemy** (estilo declarativo + API `db.query()`) | Define las tablas como clases de Python y genera el SQL. No escribimos SQL a mano: el código es portable entre SQLite y Postgres. |
| Configuración | **pydantic-settings** (`app/config.py`) | Lee `DATABASE_URL` y el resto de los settings desde el archivo `.env`. Cambiar de SQLite a Postgres es cambiar UNA línea del `.env`. |
| Acceso desde la API | **FastAPI** con dependencia `get_db()` (`app/database.py`) | Cada endpoint pide una sesión de DB como parámetro (`db: Session = Depends(get_db)`); FastAPI la abre y la cierra solo. |
| Migraciones | **`python -m app.init_db`** (create_all + micromigraciones) | Crea las tablas y agrega columnas nuevas a tablas existentes. No usamos Alembic: para el alcance del proyecto alcanza y es más simple de explicar. |

### ¿Por qué dos motores?

El mismo código ORM funciona sobre SQLite y sobre Postgres sin cambios, porque
la app **no depende de ninguna característica exclusiva de un motor** (ver
reglas de portabilidad en la sección 5). En desarrollo usamos SQLite (el
archivo vive en `backend/el-gordito.db`, está en `.gitignore`); en producción
usamos Postgres de Neon, que es una base real en la nube con respaldo.

---

## 2. Arquitectura general

```
backend/
├── app/
│   ├── config.py      → Settings (pydantic-settings): lee .env (DATABASE_URL, JWT, CORS)
│   ├── database.py    → Engine SQLAlchemy + SessionLocal + Base + get_db()
│   ├── models.py      → Las 7 tablas como clases ORM (una clase = una tabla)
│   ├── schemas.py     → Schemas Pydantic: lo que viaja por la API (in/out)
│   ├── init_db.py     → Crea tablas (create_all) + micromigraciones (ALTER TABLE)
│   └── routers/       → Endpoints que usan la DB a través de get_db()
└── .env               → DATABASE_URL (sqlite local / postgres de Neon en prod)
```

Flujo de una consulta:

```
Request HTTP → Router (FastAPI) → Depends(get_db) abre sesión SQLAlchemy
             → el router consulta los MODELOS (clases de models.py)
             → SQLAlchemy traduce a SQL y lo manda al motor (SQLite/Postgres)
             → el resultado vuelve como objetos Python → Pydantic lo serializa a JSON
             → get_db cierra la sesión en el finally
```

---

## 3. Las tablas (7)

Diagrama de relaciones:

```mermaid
erDiagram
    PEDIDO ||--|{ PEDIDO_ITEM : "tiene (cascade)"
    PEDIDO_ITEM }o--|| PRODUCTO : "producto_id (nullable, snapshot)"
    PRODUCTO ||--|{ COMBO_ITEM : "combo_id (cascade)"
    PRODUCTO ||--|{ COMBO_ITEM : "producto_id (componente)"

    PRODUCTO {
        int id PK
        string nombre
        numeric precio
        int stock
        string categoria "match por NOMBRE con categorias"
        bool disponible
        bool activo
    }
    PEDIDO {
        int id PK
        string cliente_nombre
        string telefono
        string tipo_entrega "takeaway|delivery"
        string direccion "solo delivery"
        string metodo_pago "efectivo|mercado_pago"
        numeric total
        string estado "pendiente|confirmada|cancelada"
    }
    PEDIDO_ITEM {
        int id PK
        int pedido_id FK
        int producto_id FK "nullable (snapshot)"
        string nombre "COPIA del momento del pedido"
        numeric precio_unitario "COPIA del momento del pedido"
        text elecciones "JSON: qué eligió el cliente en el combo"
    }
    COMBO_ITEM {
        int id PK
        int combo_id FK
        int producto_id FK
        int cantidad "N unidades del componente"
        string grupo "null = fijo; label = opción a elección"
    }
```

### `productos`
Todo lo que vende la pizzería: pizzas, empanadas, bebidas, postres **y también
los combos** (los combos son productos con `categoria="combo"`, precio propio y
su receta en `combo_items`).

Columnas principales: `nombre`, `descripcion`, `precio`, `precio_oferta` +
`en_oferta`, `stock` (entero), `categoria` (string, matchea el nombre en
`categorias`), `imagen_url`, `disponible` (bool, se apaga con stock=0),
`mostrar_sin_stock` (alarma de stock), `orden`, `etiqueta` (badge libre),
`activo` (interruptor de visibilidad), timestamps.

### `categorias`
Las secciones del menú (`id`, `nombre` único, `orden`). Editables por el dueño.
**Sin FK**: `productos.categoria` guarda el *nombre*, no el id (ver sección 4).

### `combo_items`
La receta de un combo: una fila por componente ("este combo lleva N unidades
del producto X"). `grupo` en NULL = componente fijo; con valor ("Empanada",
"Bebida") = las filas con el mismo label son las **opciones a elección** del
cliente. El combo **no tiene stock propio** (ver sección 4).

### `pedidos`
Un pedido enviado desde el carrito: datos del cliente (`cliente_nombre`,
`telefono`), entrega (`tipo_entrega`, `direccion`), pago (`metodo_pago`),
`notas`, `total` y `estado` (`pendiente` → `confirmada` / `cancelada`),
`created_at` y `confirmada_at`.

### `pedido_items`
Cada línea del pedido. **Tabla con diseño snapshot** (ver sección 4):
`producto_id` (nullable), `nombre`, `cantidad`, `precio_unitario` y
`elecciones` (JSON con lo que el cliente eligió en los grupos del combo).

### `admin_users`
El dueño: `username` único, `password_hash` (bcrypt, nunca la password en
claro), `nombre`. No hay usuarios clientes: el cliente solo compra, no se
registra.

### `local_config`
Datos del local (nombre, dirección, teléfono, WhatsApp, radio de delivery,
horarios, descripción). Patrón **singleton**: siempre una sola fila con `id=1`,
editable desde el dashboard (pestaña Ajustes).

---

## 4. Decisiones de diseño clave

### 4.1 Snapshot en `pedido_items` (la más importante)
Guardamos **copias** de `nombre` y `precio_unitario` al momento del pedido, no
solo el `producto_id`. ¿Por qué?

- Si mañana el dueño cambia el precio de la muzzarella, los pedidos
  **históricos** siguen mostrando lo que se cobró ese día.
- Si borra un producto del catálogo, el item del pedido sobrevive igual (por
  eso `producto_id` es **nullable**).
- El análisis "lo más vendido" funciona sobre los snapshots, sin romperse.

### 4.2 Categorías por nombre, sin FK
`productos.categoria` es un `String(40)` que matchea `categorias.nombre`, no
una clave foránea. Motivo: agregar una FK a una tabla existente exigiría
recrearla (SQLite no soporta `ALTER TABLE ADD CONSTRAINT`), y nuestro patrón de
micromigraciones solo permite `ADD COLUMN`. Los renombres de categoría se
hacen por el endpoint PUT, que actualiza los productos en cascada.

### 4.3 Combos transaccionales (sin stock propio)
El combo no reserva stock: su stock efectivo es **cuántos combos se pueden
armar** con el stock actual del local, calculado en Python
(`_stock_combo_efectivo` en `routers/productos.py`):

- Componentes fijos: `stock // cantidad` de cada uno.
- Grupos a elección: `suma de los stocks de las opciones // N`.

Al pedir un combo, la única línea de `pedido_items` (con su snapshot) se traduce
en un descuento real de stock de sus componentes — solo de los fijos y de las
opciones que el cliente eligió (`_movimientos_stock` en `routers/pedidos.py`).
Si el pedido se cancela o edita, se reintegra exactamente lo mismo.

### 4.4 Elecciones como JSON en `pedido_items`
Lo que el cliente eligió en los grupos del combo se guarda en la columna
`elecciones` como JSON:

```json
[
  {"grupo": "Empanada", "producto_id": 3, "nombre": "Carne",  "cantidad": 3},
  {"grupo": "Empanada", "producto_id": 4, "nombre": "Queso",  "cantidad": 3},
  {"grupo": "Bebida",   "producto_id": 9, "nombre": "Coca 1.5L", "cantidad": 1}
]
```

Sirve para tres cosas: (1) el dueño sabe qué entregar, (2) el stock se
descuenta de los productos elegidos, (3) si se cancela, se reintegra
exactamente eso. Usar JSON en vez de otra tabla evita un JOIN extra para un
dato que siempre se lee junto al item.

### 4.5 `NullPool` (sin pool de conexiones)
En `database.py` el engine se crea con `poolclass=NullPool`: cada request abre
y cierra su conexión. En serverless (Vercel) cada invocación es efímera; un
pool de conexiones moriría con la función y terminaría agotando las
conexiones de Neon.

---

## 5. Creación y migración de la base

### Crear/actualizar la base local

```bash
cd backend
venv\Scripts\activate
python -m app.init_db
```

Esto hace dos cosas:

1. **`create_all()`** — crea las tablas que falten a partir de los modelos.
   (No crea columnas nuevas en tablas ya existentes: limitación conocida de
   SQLAlchemy.)
2. **Micromigraciones** — la lista `MICROMIGRACIONES` de `init_db.py` trae un
   `ALTER TABLE ... ADD COLUMN` por cada columna agregada a una tabla con datos
   (ej: `combo_items.grupo`, `pedido_items.elecciones`). El script inspecciona
   qué columnas existen y aplica **solo las que faltan** — es idempotente: se
   puede correr las veces que sea sin romper nada.

Por qué no se ejecuta solo al arrancar la API: en serverless no hay un
"arranque" persistente; cada invocación es fría. Las migraciones se corren a
mano (contra SQLite en dev, contra Neon en prod) cuando cambian los modelos.

### Reglas de portabilidad (SQLite ↔ Postgres)

Todo el SQL del proyecto tiene que ser válido en **ambos** motores:

- Micromigraciones: **solo `ALTER TABLE ADD COLUMN`** con constantes (nada de
  `ADD CONSTRAINT`, `MODIFY` ni funciones propias de un motor).
- Agrupar por día (análisis de ventas) se hace **en Python**, no con funciones
  de fecha del motor (`date_trunc` de Postgres no existe en SQLite).
- Tipos ORM estándar (`Integer`, `String`, `Numeric`, `Boolean`, `Text`,
  `DateTime`), que cada motor traduce a lo suyo.

### Cambiar de entorno: una línea del `.env`

```env
# Desarrollo (archivo local, ya está en .gitignore)
DATABASE_URL=sqlite:///./el-gordito.db

# Producción (Neon)
DATABASE_URL=postgresql+psycopg2://USUARIO:PASSWORD@ep-xxxx.neon.tech/nombre?sslmode=require
```

`config.py` lo lee con pydantic-settings; `database.py` construye el engine con
esa URL. Nada más cambia. El `.env` **nunca se commitea** (contiene
credenciales); el `.db` tampoco (es dato local).

---

## 6. Resumen para la entrega

- **Modelo relacional** de 7 tablas con SQLAlchemy ORM: productos, categorías,
  combo_items, pedidos, pedido_items, admin_users, local_config.
- **SQL** como lenguaje (estándar, portable), **SQLite** en desarrollo y
  **PostgreSQL (Neon)** en producción.
- Integridad del negocio garantizada por el **backend**: precios siempre
  recalculados (snapshot), validación y descuento/reintegro de stock
  transaccional, estados de pedido controlados.
- Migraciones simples e idempotentes (`init_db.py`), pensadas para el flujo
  local → Vercel/Neon sin herramientas extra.