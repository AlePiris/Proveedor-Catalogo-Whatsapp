# Deploy a producción (Vercel + Neon + Blob) y gestión de credenciales

> Fecha: 2026-09-27 · Estado: diseño aprobado en conversación, pendiente de revisión
> Destino: catálogo web de un proveedor (reemplaza el PDF que manda por WhatsApp). Tráfico muy bajo.

## Contexto

La web funciona 100% local (Docker o venv + npm): React/Vite/Tailwind + FastAPI +
PostgreSQL/SQLite. El flujo de negocio no cambia: el cliente arma el carrito, se
envía por WhatsApp y queda `pendiente`; el dueño confirma desde el dashboard.

Este diseño cubre: (1) dejarla online gratis, (2) gestión de credenciales del
dueño (cambio y recuperación de contraseña, credenciales sin hardcodear) y
(3) limpiezas de UI para producción.

## Decisiones ya aprobadas con el socio

1. **Opción A de hosting**: Vercel (front estático + back serverless) + Neon
   (Postgres) + Vercel Blob (imágenes). Caveat conocido: Vercel Hobby es
   "no-comercial" en ToS; aceptado para este caso (tráfico ínfimo, proyecto
   de facultad con uso real mínimo). Migración futura sin tocar código.
2. `PUT /api/auth/password` para que el dueño cambie su contraseña logueado.
3. Recuperación por email a direcciones FIJAS (`RECOVERY_EMAILS`: la del dueño
   + la del dev, por las dudas). Sin pedir email en el formulario.
4. Seed lee `ADMIN_USERNAME` / `ADMIN_PASSWORD` de env vars: **sin hardcodeo**.
   La unicidad del username ya la garantiza la DB (`unique=True` en
   `models.py`), no el código.
5. Quitar la línea "Demo: admin / admin123" del login (entera).
6. El placeholder del input "Otro" del editor de pedidos queda vacío.

## 1. Arquitectura del deploy

```
Cliente → Vercel CDN (frontend estático, proyecto 1)
              │ fetch a VITE_API_URL
              ▼
         Vercel serverless (FastAPI, proyecto 2) ──► Neon (datos)
                                                  └► Blob CDN (fotos)
```

- **2 proyectos Vercel**, ambos desde el mismo repo GitHub, deploy automático
  en cada push a `main`:
  - `frontend/` → sitio estático (`vite build`), URL `*.vercel.app`.
  - `backend/` → función serverless Python. Vercel detecta FastAPI
    **zero-config** en `app/main.py` (entrypoint soportado). Solo se agrega un
    `vercel.json` mínimo para excluir `tests/` del bundle.
- **Neon**: Postgres serverless free (0.5 GB, auto-suspend). Ya soportado por
  `NullPool` en `database.py` (serverless-safe).
- **Blob**: free 1 GB storage / 10 GB transferencia mensual.
- El carrito sigue en localStorage; el pedido via WhatsApp como hoy.

## 2. Variables de entorno

### Backend (proyecto Vercel backend)

| Var | Uso | Ejemplo prod |
|---|---|---|
| `DATABASE_URL` | Neon, cadena **pooled** | `postgresql+psycopg2://...pooler...` |
| `JWT_SECRET` | firma JWT — largo y aleatorio | `openssl rand -hex 32` |
| `CORS_ORIGINS` | URL del frontend | `https://proveedor-web.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | subida/borrado de imágenes (lo genera Vercel al vincular el store) | `vercel_blob_rw_...` |
| `FRONTEND_URL` | arma el link del email de recuperación | `https://proveedor-web.vercel.app` |
| `RECOVERY_EMAILS` | destinatarios del recovery, separados por coma | `duenio@mail.com,dev@mail.com` |
| `SMTP_HOST` / `SMTP_PORT` | envío de emails (587 STARTTLS) | `smtp.gmail.com` / `587` |
| `SMTP_USER` / `SMTP_PASS` | credenciales SMTP (Gmail: usuario + app-password con 2FA) | |
| `EMAIL_FROM` | remitente visible | mismo que `SMTP_USER` |
| `ADMIN_USERNAME` | username del dueño para el seed | |
| `ADMIN_PASSWORD` | password inicial del dueño para el seed (luego la cambia él) | |

### Frontend (proyecto Vercel frontend)

| Var | Uso |
|---|---|
| `VITE_API_URL` | URL del backend (se hornea en el build: cambiarla = redeploy) |
| `VITE_WA_NUMBER` | fallback del WhatsApp (el real lo setea el dueño en Ajustes) |

### Seed

`ADMIN_USERNAME` y `ADMIN_PASSWORD` son **requeridas**: si falta alguna, el
seed termina con error claro indicando cuál falta. En dev se ponen en
`backend/.env` (fuera de git); `.env.example` las documenta. Docker Compose
las agrega al servicio `backend` para que el flujo local no cambie. Los tests
NO dependen del seed (crean su propio admin en `conftest.py`), no se tocan.

## 3. Imágenes: disco local → Vercel Blob

**Problema**: serverless no persiste disco; hoy se guarda en `backend/uploads/`
y se sirve con StaticFiles.

**Diseño**: helper único en el backend (`guardar_archivo(nombre, contenido,
content_type) -> url` y `borrar_archivo(url)`), con switch por entorno:

- **Sin `BLOB_READ_WRITE_TOKEN`** (dev y tests): disco `backend/uploads/`,
  URL relativa `/uploads/<archivo>` — comportamiento actual, los 31 tests
  y el proxy de Vite siguen igual.
- **Con token** (prod): HTTP directo a la API REST de Blob (verificada, sin
  SDK de Node):
  - Subir: `PUT https://vercel.com/api/blob/?pathname=<nombre>` con headers
    `Authorization: Bearer <token>`, `x-content-type`, `x-vercel-blob-access:
    public`, `x-add-random-suffix: 1`. Devuelve JSON con `url` (absoluta).
  - Borrar: `POST https://vercel.com/api/blob/delete` con `{"urls": [...]}`.
  - La URL absoluta se guarda en `producto_imagenes.url` / `imagen_url` como
    hoy guarda la relativa: el resto del código (galería, imagen principal,
    frontend) no cambia porque ya consumen la URL tal cual.

Producción arranca con DB nueva (Neon se inicializa con `init_db` + `seed`
desde la máquina local): **no hay migración de imágenes viejas**.

## 4. Credenciales del dueño

### 4a. Seed sin hardcodeo

`seed.py` deja de usar `admin`/`admin123` literales: busca/crea el AdminUser
por `settings.admin_username` y hashea `settings.admin_password`. Unicidad
garantizada por la constraint `unique` de la columna username. Si el usuario
ya existe, no lo duplica ni lo modifica (idempotente, como hoy).

### 4b. Cambio de contraseña logueado

- `PUT /api/auth/password` (requiere admin): body `{password_actual,
  password_nueva}`. Verifica la actual con bcrypt → guarda el nuevo hash →
  400/401 correspondientes. Longitud mínima 8.
- Frontend: form en el dashboard (Ajustes) "Cambiar contraseña".

### 4c. Recuperación ("olvidé la contraseña")

Nueva tabla `password_resets`:

| Columna | Tipo | Nota |
|---|---|---|
| `id` | Integer PK | |
| `admin_id` | FK → admin_users | el admin al que pertenece |
| `token_hash` | String(255), unique | SHA-256 del token — nunca el token en claro |
| `expira_en` | DateTime | emisión + 30 min |
| `usado` | Boolean default False | de un solo uso |
| `created_at` | DateTime | |

Endpoints (ambos públicos, respuestas genéricas — nunca confirman si existe
una cuenta):

- `POST /api/auth/recuperar`: genera `secrets.token_urlsafe(32)`, guarda su
  hash, y envía a TODOS los `RECOVERY_EMAILS` un email con el link
  `{FRONTEND_URL}/restablecer-password?token=<token>`. Siempre responde 200
  con mensaje genérico. Rate limit best-effort en memoria (máx ~3 requests/min
  por instancia): serverless no comparte memoria entre instancias, es una
  mitigación práctica, no una garantía — aceptado para este alcance.
- `POST /api/auth/restablecer`: body `{token, password_nueva}`. Valida que
  exista, no esté usado ni expirado → cambia el hash del admin → marca usado.
  400 con mensajes claros en cada caso. Longitud mínima 8.

Frontend:

- Link "Olvidé mi contraseña" en AdminLogin → `POST recuperar` → pantalla de
  "revisá tu email".
- Ruta `/restablecer-password?token=...` → form de nueva password →
  `POST restablecer` → redirige al login con mensaje de éxito.

### 4d. Envío de email

Nuevo módulo `backend/app/emails.py`: `enviar_email(asunto, cuerpo, destinatarios)`
con `smtplib` + STARTTLS, configurado por las vars SMTP_*. Recomendado:
**Gmail con app-password** (gratis, 2FA activado, remitente = tu Gmail).
Alternativa documentada: Brevo free (300/día) cambiando `SMTP_HOST` — mismo
código. Los tests mockean este módulo: nunca envían emails de verdad.

## 5. Limpieza de UI para producción

1. `AdminLogin.tsx`: borrar la línea "Demo: admin / admin123" (entera; las
   credenciales quedan en docs privadas, no en la web pública).
2. `GestionPedidos.tsx`: placeholder del input "Otro" → vacío.
3. Agregar el link "Olvidé mi contraseña" y las 2 páginas nuevas (4c).
4. **Modales propios** (agregado en la revisión del 2026-09-28): reemplazar
   los 7 `confirm()`/`prompt()` nativos (muestran "localhost:5173 dice:", y en
   prod mostrarían la URL de Vercel) por `components/Modal.tsx`:
   - `ConfirmModal` (título, mensaje, Cancelar/Confirmar — rojo en destructivas):
     borrar producto, borrar categoría, borrar combo, borrar foto, cancelar pedido.
   - `ModalInput` (campo prellenado, mismas validaciones): precio de oferta,
     renombrar categoría.
   - Esc o click fuera cierra (= cancelar), Enter confirma, estética del tema
     (`bg-negro-panel`, etc.). Las páginas guardan en state qué diálogo está abierto.
5. Actualizar `ESTADO-PROYECTO.md` y `README.md`: estado real (proveedor,
   combos, categorías, galería, tests, deploy).

## 6. Pasos de deploy (orden)

1. Implementar 3, 4, 5 con tests → suite verde local.
2. Crear proyecto Neon → copiar cadena pooled.
3. Proyecto Vercel **backend** (root `backend/`): env vars, vincular Blob
   store (genera el token) → verificar `GET /api/health`.
4. Desde la máquina local: `init_db` + `seed` contra Neon (con
   `ADMIN_USERNAME`/`ADMIN_PASSWORD` de prod).
5. Proyecto Vercel **frontend** (root `frontend/`): `VITE_API_URL`.
6. Smoke test en prod: tienda carga → login dueño → cambio de contraseña →
   subir imagen (verificar URL de Blob) → pedido de prueba por WhatsApp →
   confirmar desde dashboard → flujo de recuperación completo.
7. El dueño completa Ajustes (nombre, WhatsApp, horarios) y carga productos.

## 7. Estrategia de testing

- Existentes: 31 tests siguen verde (helper de guardado sin token = disco,
  como hoy; `uploads_dir` fixture sigue mockeando el directorio).
- Nuevos (SQLite memoria, emails mockeados):
  - cambio de contraseña: correcta, actual incorrecta, longitud mínima.
  - recuperación: token válido cambia la password; token expirado/usado/
  inexistente → 400; token de un solo uso; link armado con `FRONTEND_URL`.
  - seed: requiere las env vars (error claro si faltan); idempotente.
- Frontend: `tsc && vite build` verde.

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Vercel bloqueara SMTP saliente (hoy lo permite) | Cambiar `SMTP_HOST` a Brevo; mismo código |
| ToS Hobby no-comercial | Aceptado para este alcance; migración futura sin tocar código |
| Cold start (~1s) + Neon auto-suspend (~0.5s) | Irrelevante con tráfico bajo |
| `VITE_*` horneadas en build | Documentado: cambiarlas = redeploy |
| Rate limit de recuperación imperfecto (serverless) | Aceptado: token 30 min + un solo uso + emails fijos |

## 9. Fuera de alcance (YAGNI)

- Registro de usuarios / múltiples admins.
- Cambiar el username desde la UI.
- Migrar datos de la DB local a prod (prod arranca con seed).
- Rebranding visual (el nombre editable ya vive en Ajustes/`LocalConfig`).
- Dominio propio (se usan los `*.vercel.app` gratis).