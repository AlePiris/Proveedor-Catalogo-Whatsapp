# Pizzería El Gordito — Estado del proyecto

> Block de notas / resumen del proyecto. Última actualización: 2026-08-25.
> Repo: https://github.com/AlePiris/El-Gordito (rama `main`)

## Qué es
Web para pizzería que **no cobra online**. El carrito arma un mensaje de WhatsApp
con el pedido + total + detalles; el dueño confirma la compra desde un dashboard;
solo los pedidos **confirmados** alimentan el análisis "lo más vendido".

Trabajo integrador Frontend + Backend de la facultad.

---

## Cómo correrlo local (VS Code)

Necesitás **dos terminales**. Los `.env` ya están creados (`backend/.env` y
`frontend/.env.local`), así que no pasás variables a mano.

**Terminal 1 — Backend (puerto 8800):**
```powershell
cd C:\PP4\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8800 --reload
```
> Si borraste la base o es la primera vez, antes corré una sola vez:
> `.\.venv\Scripts\python.exe -m app.init_db` y `...\-m app.seed`

**Terminal 2 — Frontend (puerto 5173):**
```powershell
cd C:\PP4\frontend
npm run dev
```

**Navegador:**
- Tienda: http://localhost:5173
- Admin: http://localhost:5173/admin → `admin` / `admin123`
- Docs API: http://localhost:8800/docs

Si los puertos están ocupados por un server que quedó colgado:
`Get-Process python | Stop-Process` (backend) o cerrá la terminal del frontend.

---

## Arquitectura (resumen)

**Monolito de 3 capas** separadas solo por HTTP/JSON:

- **Backend** (`backend/app/`, FastAPI):
  - `main.py` — crea la app, CORS, monta `/uploads` (StaticFiles), incluye routers.
  - `config.py` — lee `.env` con pydantic-settings (`case_sensitive=False`).
  - `database.py` — SQLAlchemy + **NullPool** (serverless-safe).
  - `models.py` — tablas: Producto, AdminUser, Pedido, PedidoItem.
  - `schemas.py` — Pydantic (validación entrada/salida, separado de models).
  - `auth.py` — bcrypt **directo** (sin passlib) + JWT.
  - `routers/` — productos, pedidos, analisis, auth.
  - `seed.py` / `init_db.py` — datos demo + creación de tablas.
- **Frontend** (`frontend/src/`, React+Vite+TS+Tailwind):
  - `api/client.ts` — wrapper fetch, doble base URL (`/api` dev / `VITE_API_URL` prod).
  - `context/CartContext.tsx` — carrito en localStorage (useReducer).
  - `pages/` — Tienda, Carrito, AdminLogin, AdminDashboard + admin/* (GestionProductos, GestionPedidos, Analisis).
  - `components/` — Navbar, ProductoCard.
- **DB**: PostgreSQL. Local: SQLite (`backend/pizzeria.db`) o Docker Compose. Prod: Neon.

**Decisiones clave:**
- `pedido_items` guarda **snapshot** de nombre/precio → el histórico sobrevive
  cambios de precio/borrado de producto. `producto_id` es nullable.
- Pedido: `pendiente` → `confirmada`/`cancelada`. El análisis solo mira `confirmada`.
- Carrito **nunca cobra**: abre `wa.me` y guarda el pedido `pendiente`.

---

## Features implementadas

1. **Catálogo + ofertas primero** (orden: `en_oferta DESC, orden ASC`).
2. **Carrito** con persistencia en localStorage → mensaje WhatsApp + POST `/api/pedidos`.
3. **Dashboard admin** (login JWT): gestión de productos, pedidos (editar/confirmar/cancelar), análisis.
4. **Alarma de stock** (`mostrar_sin_stock`):
   - GET público filtra `stock>0 OR mostrar_sin_stock` → sin-stock se OCULTA al cliente.
   - El dueño puede "desactivar la alarma" → el producto se muestra marcado "SIN STOCK".
   - El número de stock solo lo ve el dueño.
5. **Subida de imágenes**: `POST /api/productos/{id}/imagen` → `backend/uploads/`, servido en `/uploads`.
   Frontend: input file al crear producto + botón 📷 por card.
6. **Cards** tanto para el cliente como para el dueño (admin edita nombre/desc/precio/stock, toggles oferta y alarma, borrar, imagen).

---

## Bugs ya fixeados (para no volver a tropezar)

1. **passlib + bcrypt 4.x**: `passlib` lee `bcrypt.__about__.__version__` que bcrypt 4 eliminó.
   → Fix: eliminado passlib, bcrypt directo (`hashpw`/`checkpw`).
2. **`.env` ignorado**: `config.py` tenía `case_sensitive=True`; el campo `database_url`
   no matcheaba `DATABASE_URL` del archivo (las vars del SO funcionaban por ser
   case-insensitive en Windows). → Fix: `case_sensitive=False`.
3. **Desajuste de rutas en uploads**: `productos.py` guardaba en `backend/app/uploads`
   (2 `dirname`), pero `main.py` servía de `backend/uploads`. → 404, no se veían las imágenes.
   → Fix: `productos.py` usa 3 `dirname` → `backend/uploads`.
4. **Vite no resuelve `@/`**: Rollup no lee `tsconfig` paths. → Fix: `resolve.alias` en `vite.config.ts`.

---

## Deploy (Vercel + Neon, gratuito) — pendiente de hacer

- **Backend**: proyecto Vercel, Root Directory = `backend/`. Vercel detecta FastAPI
  zero-config (`app/main:app`). Env vars: `DATABASE_URL` (Neon), `JWT_SECRET`, `CORS_ORIGINS`.
- **Frontend**: proyecto Vercel, Root Directory = `frontend/`. Env vars: `VITE_API_URL`
  (URL del backend), `VITE_WA_NUMBER`.
- **DB**: Neon (Postgres serverless, free). Correr `init_db`/`seed` local contra Neon.
- **Imágenes en prod**: el disco serverless no persiste → migrar `/imagen` a **Vercel Blob**
  (`@vercel/blob`), que devuelve una URL absoluta a guardar en `imagen_url`.

Límites free (Vercel Hobby + Neon Free) verificados 2026-08-25: alcanzan con holgura
para una pizzería. Hobby = solo uso personal/no-comercial (OK para facultad).

---

## Datos importantes
- Admin demo: `admin` / `admin123` (se carga con `seed.py`).
- WhatsApp de prueba (en `frontend/.env.local`): `5491100000000` (cambiar al real).
- Puerto backend: **8800** (evita 8000/8080/18000 que usa el usuario en otros proyectos).
- `.env` y `.env.local` **no** están en git (tienen secretos); `.env.example` sí (placeholders).