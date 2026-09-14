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
Frontend (desde `frontend/`): `npm install && npm run dev`

## Deploy gratuito (Vercel + Neon)

- **Frontend** → Vercel (sitio estático). Root Directory: `frontend/`.
- **Backend** → Vercel (función serverless, detecta FastAPI). Root: `backend/`.
- **DB** → Neon (Postgres serverless gratuito).

Ver pasos detallados en el plan del proyecto.

## Estructura

```
backend/   → FastAPI (app/, routers/, models, schemas, auth)
frontend/  → React Vite TS (src/pages, components, context, api)
```
