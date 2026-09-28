# Pizzería El Gordito — Estado del proyecto

> Block de notas / resumen del proyecto. Última actualización: 2026-09-28.
> Repo: https://github.com/AlePiris/El-Gordito (rama `main`)
> Ubicación local (PC de Ale): C:\Users\ale_p\OneDrive\Escritorio\El-Gordito
> (antes estaba en C:\PP4 — mismo repo, otra carpeta)

## Qué es
Web para pizzería que **no cobra online**. El carrito arma un mensaje de WhatsApp
con el pedido + total + detalles; el dueño confirma la compra desde un dashboard;
solo los pedidos **confirmados** alimentan el análisis "lo más vendido".

Trabajo integrador Frontend + Backend de la facultad. **Destino real: catálogo
de un proveedor** (un compañero de Ale que hoy manda un PDF con su oferta por
WhatsApp; la web lo reemplaza). Tráfico muy bajo. El "pizzería" de los nombres
es histórico — el branding real se configura desde Ajustes (`LocalConfig`),
así que NO hace falta reescribir código para rebrandear.

---

## Sesión 2026-09-27/28 — deploy + credenciales (decisiones y POR QUÉ)

> Detalle completo del diseño en
> `docs/superpowers/specs/2026-09-27-deploy-produccion-design.md`.
> Estado al cerrar la sesión: **especificado y aprobado, SIN implementar todavía**.
> Verificado en verde: 31 tests backend, `tsc && vite build` frontend, git
> sincronizado con `origin/main`.

1. **Hosting: Vercel (front estático + back serverless) + Neon (Postgres) +
   Vercel Blob (imágenes)**, todo free.
   - Por qué Vercel y no Render/Koyeb free: estos duermen tras ~15 min sin
     visitas → el primer cliente espera 30-60s. El dueño manda el link por
     WhatsApp: mala primera impresión. Serverless solo tiene cold start ~1s.
   - Caveat asumido: Vercel Hobby = "no comercial" en ToS. Para el catálogo de
     un compañero con tráfico ínfimo, riesgo aceptado. Si crece: migrar sin
     tocar código (o Vercel Pro $20/mes).
   - Por qué Neon: Postgres serverless real, 0.5 GB free, auto-suspend. Ya
     soportado: `database.py` usa NullPool (serverless-safe).
   - Cómo entra el back: Vercel detecta FastAPI zero-config en `app/main.py`.
     Solo un `vercel.json` chico para excluir `tests/` del bundle.
2. **Imágenes → Vercel Blob** (bloqueante del deploy): serverless NO persiste
   disco; hoy se guardan en `backend/uploads/` y las sirve StaticFiles. Diseño:
   helper `guardar_archivo()` con switch por entorno — sin
   `BLOB_READ_WRITE_TOKEN` escribe a disco como hoy (dev y los 31 tests no se
   tocan); con token sube por HTTP a la API REST de Blob y devuelve URL
   absoluta que se guarda en la DB (el resto del código ya consume la URL tal
   cual, no cambia). Prod arranca con DB nueva (seed contra Neon): NO hay que
   migrar imágenes viejas.
3. **Credenciales del dueño, SIN hardcodeo.** Problema encontrado: el seed
   crea `admin`/`admin123` hardcodeados y NO existía forma de cambiar la
   password (ni endpoint ni pantalla). Decidido:
   - Seed lee `ADMIN_USERNAME` / `ADMIN_PASSWORD` de env vars (REQUERIDAS: si
     falta alguna, error claro). La unicidad del username la garantiza la DB
     (`unique=True`), no el código. Los tests no dependen del seed (crean su
     propio admin en `conftest.py`).
   - `PUT /api/auth/password`: cambiar la password logueado (pide actual +
     nueva), form en Ajustes. Así el dueño pasa de la password inicial a la
     suya desde el dashboard.
   - **"Olvidé mi contraseña"**: email con link de restablecimiento a
     `RECOVERY_EMAILS` (mail del dueño + mail de Ale, fijos — no se pide email
     en el form). Tabla `password_resets` (hash SHA-256 del token, expira 30
     min, de un solo uso). Envío por SMTP (recomendado: Gmail app-password
     con 2FA; alternativa Brevo cambiando `SMTP_HOST`, mismo código).
4. **Limpieza de UI para producción**:
   - Sacar la línea "Demo: admin / admin123" del login (quedaría pegada en la
     web pública).
   - Placeholder del input "Otro" del editor de pedidos → vacío (decía
     "Nombre del extra (ej. 'bacon extra')").
5. **Modales propios** (detectado en la revisión del 09-28): los `confirm()` /
   `prompt()` nativos muestran "localhost:5173 dice:" (en prod diría la URL de
   Vercel). Diseño: `components/Modal.tsx` con ConfirmModal (los 5 confirm:
   borrar producto/categoría/combo/foto, cancelar pedido) y ModalInput con
   campo prellenado (los 2 prompt: precio de oferta, renombrar categoría).
   Esc o click afuera = cancelar, Enter = confirmar, estética del tema.

**Cómo funciona hoy el login** (contexto para entender el punto 3): no hay
registro de usuarios; la única cuenta la crea el seed. El password se guarda
solo como hash bcrypt; el login devuelve un JWT firmado con `JWT_SECRET`
(vence a las 8 hs) que viaja como `Authorization: Bearer` y valida
`require_admin` en cada endpoint admin.

---

## Cómo correrlo local (VS Code)

Necesitás **dos terminales**. Los `.env` ya están creados (`backend/.env` y
`frontend/.env.local`), así que no pasás variables a mano.

**Terminal 1 — Backend (puerto 8800):**
```powershell
cd C:\Users\ale_p\OneDrive\Escritorio\El-Gordito\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8800 --reload
```
> Si borraste la base o es la primera vez, antes corré una sola vez:
> `.\.venv\Scripts\python.exe -m app.init_db` y `.\.venv\Scripts\python.exe -m app.seed`
> (con `backend/.env` apuntando a SQLite local — ese archivo NO está en git,
> recrealo desde `.env.example` si clonaste en otra PC).

**Terminal 2 — Frontend (puerto 5173):**
```powershell
cd C:\Users\ale_p\OneDrive\Escritorio\El-Gordito\frontend
npm run dev
```

**Navegador:**
- Tienda: http://localhost:5173
- Admin: http://localhost:5173/admin → `admin` / `admin123`
- Docs API: http://localhost:8800/docs

Si los puertos están ocupados por un server que quedó colgado:
`Get-Process python | Stop-Process` (backend) o cerrá la terminal del frontend.

---

## Tests del backend

```powershell
cd backend
.\venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt   # primera vez
.\venv\Scripts\python.exe -m pytest -v
```

La suite corre contra una **base SQLite en memoria** (aislada por test) y
escribe imágenes en un **directorio temporal**: nunca toca la base de
desarrollo ni `backend/uploads/`. Cubre: galería de imágenes, stock efectivo
de combos y ciclo de vida de pedidos. Diseño:
`docs/superpowers/specs/2026-09-24-backend-tests-design.md`.

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

## Deploy (Vercel + Neon, gratuito) — diseño aprobado, pendiente de ejecutar

Estrategia final y razones: ver sección "Sesión 2026-09-27/28" arriba y la
spec completa en `docs/superpowers/specs/2026-09-27-deploy-produccion-design.md`
(env vars por tabla, pasos en orden, riesgos con mitigaciones, testing).

Resumen operativo:
- **Backend**: proyecto Vercel, Root Directory = `backend/` (detecta FastAPI
  zero-config). Env vars: `DATABASE_URL` (Neon pooled), `JWT_SECRET`,
  `CORS_ORIGINS`, `BLOB_READ_WRITE_TOKEN`, `FRONTEND_URL`, `RECOVERY_EMAILS`,
  `SMTP_*`, `EMAIL_FROM`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
- **Frontend**: proyecto Vercel, Root Directory = `frontend/`. Env vars:
  `VITE_API_URL` (URL del backend; horneada en el build, cambiar = redeploy),
  `VITE_WA_NUMBER` (fallback; el real lo setea el dueño en Ajustes).
- **DB**: Neon free. `init_db` + `seed` corren UNA VEZ desde la PC local
  apuntando a la cadena de Neon, con las `ADMIN_*` de producción.
- **Imágenes**: Vercel Blob (1 GB free) vía su API REST desde Python.

Límites free (Vercel Hobby + Neon + Blob) verificados 2026-09-27: alcanzan
con holgura para el tráfico esperado.

---

## Datos importantes
- Admin demo: `admin` / `admin123` (se carga con `seed.py`).
- WhatsApp de prueba (en `frontend/.env.local`): `5491100000000` (cambiar al real).
- Puerto backend: **8800** (evita 8000/8080/18000 que usa el usuario en otros proyectos).
- `.env` y `.env.local` **no** están en git (tienen secretos); `.env.example` sí (placeholders).