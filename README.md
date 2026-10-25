# Proveedor Web — Trabajo Integrador (Frontend + Backend)

Web para una pizzería que **no cobra online**: el cliente arma el carrito, se
envía un pedido por **WhatsApp** y **se guarda en la base de datos** como
`pendiente`. El dueño, desde un dashboard, **edita y confirma** el pedido (porque
por WhatsApp pueden sumarse o quitarse cosas). Solo los pedidos **confirmados**
alimentan el análisis de "lo más vendido".

## Arquitectura

Monolito de 3 capas (separadas, comunicadas solo por HTTP/JSON):

- **Frontend**: React + Vite + TypeScript + Tailwind (carrito y dashboard).
- **Backend**: FastAPI (Python) — API REST (CRUD productos, login admin,
  pedidos, análisis).
- **Base de datos**: PostgreSQL.

El carrito vive en el navegador (localStorage) y **nunca cobra**: arma un link
`wa.me` con el mensaje del pedido y, a la vez, hace `POST /api/pedidos`.

## Desarrollo local (Docker Compose)

Levanta base de datos + backend + frontend con un comando:

```bash
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8800   (el 8000/8080/18000 están reservados para otros proyectos)
- Docs Swagger: http://localhost:8800/docs

> Copia `.env.example` a `.env` (raíz) antes de levantar.

### Sin Docker (alternativa)

Backend (desde `backend/`):
```bash
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
set DATABASE_URL=postgresql+psycopg2://pizzeria:pizzeria@localhost:5432/pizzeria
.venv/Scripts/python -m app.init_db
.venv/Scripts/python -m app.seed
.venv/Scripts/uvicorn app.main:app --port 8800 --reload
```
> El `seed` exige `ADMIN_USERNAME` y `ADMIN_PASSWORD`: ponelas en
> `backend/.env` en dev (copiá `.env.example` para ver todas las vars).

Frontend (desde `frontend/`): `npm install && npm run dev`

## Deploy gratuito (Vercel + Neon + Blob)

Arquitectura: Vercel (front estático + back serverless FastAPI) + Neon (Postgres)
+ Vercel Blob (imágenes). Especificación completa: `docs/superpowers/specs/2026-09-27-deploy-produccion-design.md`.

Orden de alta (runbook):

1. **Neon**: crear proyecto → copiar el connection string **pooled** → `DATABASE_URL`.
2. **Secretos**: `openssl rand -hex 32` para `JWT_SECRET`.
3. **Backend** (Vercel, Root Directory `backend/`): env vars `DATABASE_URL`,
   `JWT_SECRET`, `CORS_ORIGINS`, `FRONTEND_URL`, `RECOVERY_EMAILS`, `SMTP_*`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, y vincular el Blob store (genera
   `BLOB_READ_WRITE_TOKEN`). Verificar `https://<backend>/api/health`.
4. **DB**: desde la máquina local, apuntando a Neon:
   `.venv/Scripts/python -m app.init_db && .venv/Scripts/python -m app.seed`
   (el seed requiere las `ADMIN_*`; crea al dueño con bcrypt).
5. **Frontend** (Vercel, Root Directory `frontend/`): env vars `VITE_API_URL`
   y `VITE_WA_NUMBER` (se hornean en el build).
6. **Smoke test**: tienda carga → login del dueño → cambio de contraseña →
   subir foto (URL de Blob) → pedido de prueba → confirmar en dashboard →
   recuperación de contraseña por email.

> Credenciales: el login NO tiene usuario demo publicado. `ADMIN_*` viven solo
> en env vars (`backend/.env` en dev, Vercel en prod) y la contraseña se cambia
> desde Ajustes; hay recuperación por email si se pierde.

## Estructura

```
backend/   → FastAPI (app/, routers/, models, schemas, auth)
frontend/  → React Vite TS (src/pages, components, context, api)
```
