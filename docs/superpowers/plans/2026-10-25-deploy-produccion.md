# Plan de implementación: Deploy a producción (spec 2026-09-27)

**Para agentes:** SUB-SKILL REQUERIDO: superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkbox (`- [ ]`).

**Goal:** dejar la web lista para producción — credenciales del dueño sin hardcodeo (seed por env vars, cambio y recuperación de contraseña), imágenes en Vercel Blob vía helper único con switch por entorno, limpiezas de UI, y el runbook de deploy Vercel + Neon + Blob.

**Arquitectura:** FastAPI monolito (mismo repo). Nuevo módulo `storage.py` único para guardar/borrar archivos (disco local sin token Blob, API REST de Blob con token). Nuevo `emails.py` (smtplib, mockeado en tests). Nueva tabla `password_resets`. Las 7 llamadas nativas `confirm()/prompt()` se reemplazan por `components/Modal.tsx`.

**Stack:** FastAPI + SQLAlchemy + bcrypt; React/Vite/Tailwind; Vercel (front + back serverless), Neon (Postgres), Vercel Blob.

**Spec:** `docs/superpowers/specs/2026-09-27-deploy-produccion-design.md` (leer junto con este plan).

## Global Constraints

- Sin tokens Blob en el entorno → todo va a disco `backend/uploads/` con URL relativa `/uploads/<archivo>` (dev y tests, comportamiento actual). Con `BLOB_READ_WRITE_TOKEN` → API REST de Blob (sin SDK de Node).
- La password en claro nunca se guarda (bcrypt `hash_password` de `app/auth.py`).
- Respuestas de recuperación siempre genéricas: nunca confirman si la cuenta existe.
- Token de reset: `secrets.token_urlsafe(32)`, se guarda SOLO su SHA-256, 30 min, un solo uso.
- `ADMIN_USERNAME`/`ADMIN_PASSWORD` requeridas por el seed (error claro si faltan); si el admin ya existe, no se toca.
- Los emails de recuperación van SOLO a `RECOVERY_EMAILS` (fijas por env); el formulario no pide email.
- Nada de dependencias nuevas para Blob/email: stdlib (`urllib.request`, `smtplib`).
- Suite backend: `cd backend; .venv\Scripts\python -m pytest -q` → todo verde. Frontend: `cd frontend; npm run build` → `tsc` limpio (sin test runner; la verificación de UI es build + smoke manual).

## Review Focus

1. **Borrar foto en la galería admin** — el dueño espera que el archivo físico también se borre (no huérfanos): pinneado por `test_archivos_fisicos_viven_y_mueren_con_las_filas` (existe) + Task 1.
2. **Logo sin imagen** — GET `/api/config` debe devolver `logo_url: ""` cuando nunca se subió: `test_sin_logo_el_get_publico_trae_vacio` (existe, Task 1 no debe romperlo).
3. **Token de reset reusado o expirado** — debe dar 400, no 200/500: Task 4 (tests de token usado, expirado e inexistente).
4. **Recuperación con username inexistente** — responde 200 genérico igual: Task 4.
5. **Seed sin env vars en un deploy real** — debe cortar con mensaje que nombre la variable faltante, ANTES de tocar la DB: Task 2.

---

### Task 1: Helper de archivos (`storage.py`) con switch Blob

**Files:**
- Create: `backend/app/storage.py`
- Modify: `backend/app/routers/productos.py` (usar el helper; borrar su `UPLOAD_DIR`), `backend/app/routers/config_local.py` (logo usa el helper), `backend/tests/conftest.py` (fixture `uploads_dir` parchea `app.storage.UPLOAD_DIR`)
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Consumes: nada (modulo nuevo; lee `settings.blob_read_write_token` — Task 0 inline abajo).
- Produces: `guardar_archivo(nombre: str, contenido: bytes, content_type: str) -> str` (devuelve `/uploads/<nombre>` o la URL absoluta de Blob); `borrar_archivo(url: str) -> None`; constante `UPLOAD_DIR`. `productos.py` y `config_local.py` consumen esto.

- [ ] **Step 1: Agregar a `Settings` en `app/config.py`** (con default vacío): `blob_read_write_token: str = ""`

- [ ] **Step 2: Escribir `backend/tests/test_storage.py`** — casos: (a) sin token, `guardar_archivo` crea el archivo en `UPLOAD_DIR` (usar la fixture `uploads_dir`) y devuelve `/uploads/<nombre>`; (b) `borrar_archivo("/uploads/x")` elimina el archivo si existe y no explota si no; (c) con token (monkeypatch `settings.blob_read_write_token` + mock de `urllib.request.Request`), `guardar_archivo` escribe el archivo y devuelve la `url` del JSON de respuesta. Estructura igual a `test_galeria.py`.

- [ ] **Step 3: Run** `.venv\Scripts\python -m pytest tests\test_storage.py -v` → FAIL (módulo no existe).

- [ ] **Step 4: Implementar `app/storage.py`**: `UPLOAD_DIR` con el mismo cálculo de ruta que tenía `productos.py` (3 dirnames: routers→app→backend). Dev: `os.makedirs` + escribir. Prod (token seteado): `PUT https://vercel.com/api/blob/?pathname=<nombre url-encoded>` con `Authorization: Bearer <token>`, `x-content-type`, `x-vercel-blob-access: public`, `x-add-random-suffix: 1`; devolver `json.loads(resp)["url"]`. `borrar_archivo`: dev → `os.remove` con try/except OSError (mismo criterio actual); prod → `POST .../api/blob/delete` con `{"urls": [url]}`.

- [ ] **Step 5: Run tests/test_storage.py** → PASS.

- [ ] **Step 6: Refactor**: `productos.py` — importar `from app.storage import UPLOAD_DIR, guardar_archivo, borrar_archivo`, borrar su constante; `subir_imagen` llama `url = guardar_archivo(nombre, datos, content_type)`; el "limpiar archivos al borrar producto" usa `os.remove(os.path.join(UPLOAD_DIR, nombre))` en su glob como hoy. `config_local.py` — los helpers `_guardar_archivo`/`_quitar_archivo_logo` pasan a llamar a `storage` (quedan como envoltura local, la firma del router no cambia). `conftest.py` `uploads_dir` — parchear `app.storage.UPLOAD_DIR`.

- [ ] **Step 7: Suite completa** → PASS incl. los 8 de `test_config_logo.py` (`test_subir_logo_guarda_url_y_archivo` pinnea que el logo también va por storage).

- [ ] **Step 8: Commit** `refactor: helper de archivos storage.py con switch Vercel Blob`

### Task 2: Seed sin hardcodeo

**Files:**
- Modify: `backend/app/seed.py`, `backend/app/config.py`, `docker-compose.yml`, `.env.example`
- Test: `backend/tests/test_seed.py`

**Interfaces:**
- Produces: `crear_admin(db: Session) -> None` extraída de `seed.main()` — busca/crea `AdminUser(username=settings.admin_username, password_hash=hash_password(settings.admin_password), nombre="Dueño")` si no existe; si existe, no lo modifica. `settings` suma `admin_username: str = ""`, `admin_password: str = ""`.

- [ ] **Step 1: Test `test_seed.py`** (monkeypatch sobre `settings` + sesión de test propia): (a) sin creds → `SystemExit` con mensaje que nombra la var faltante, sin escribir DB; (b) con creds → crea el admin con hash verificable (`verify_password`); (c) idempotente — correr dos veces no duplica y con otro password no cambia el hash.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar**: `main()` valida primero `settings.admin_username`/`settings.admin_password` (`raise SystemExit("Falta definí ADMIN_USERNAME en el .env")` — mensaje nombra la var); crea la sesión DESPUÉS de validar; llama `crear_admin(db)`. El resto del seed no cambia.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: `.env.example` + `docker-compose.yml`**: documentar `ADMIN_USERNAME`/`ADMIN_PASSWORD` (compose: valores dev `admin/admin123`; producción = suyos, se cargan en Vercel). `seed.py` header docstring actualizado.
- [ ] **Step 6: Suite completa** → PASS.
- [ ] **Step 7: Commit** `feat: seed lee ADMIN_USERNAME/ADMIN_PASSWORD de env vars`

### Task 3: Cambio de contraseña (dueño logueado)

**Files:**
- Modify: `backend/app/schemas.py` (PasswordChange), `backend/app/routers/auth.py`, `frontend/src/types.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/admin/Ajustes.tsx`
- Test: `backend/tests/test_password.py`

**Interfaces:**
- Consumes: `require_admin`, `verify_password`, `hash_password`, SessionLocal pattern de conftest.
- Produces: schema `PasswordChange(password_actual: str, password_nueva: str)`; endpoint `PUT /api/auth/password` → 200 `{"ok": true}` (o 400 actual-incorrecta / corta; 401 sin token); `api.admin.cambiarPassword(actual, nueva) -> {"ok": boolean}`.
- Nota: el admin viene de `Depends(require_admin)` (devuelve el AdminUser; ver `auth.py:55`).

- [ ] **Step 1: Tests `test_password.py`**: (a) password correcta + nueva ≥8 → 200, y el login nuevo funciona con la nueva y NO con la vieja; (b) actual incorrecta → 400; (c) nueva con 7 chars → 400; (d) sin token → 401.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar endpoint** en `routers/auth.py`: valida longitud (`len < 8` → 400), `verify_password(password_actual, admin.password_hash)` → si no, 400 "La password actual es incorrecta"; guarda `hash_password(password_nueva)`; commit.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Frontend**: `LocalConfig`-independiente — card nueva "Cambiar contraseña" en `Ajustes.tsx` (3 inputs: actual, nueva, repetir; valida repetir igual y nueva ≥8) → `api.admin.cambiarPassword`. Mensaje de éxito inline.
- [ ] **Step 6: `npm run build`** → limpio.
- [ ] **Step 7: Suite backend completa** → PASS.
- [ ] **Step 8: Commit** `feat: cambio de contrasena del dueno logueado`

### Task 4: Recuperación por email

**Files:**
- Create: `backend/app/emails.py`
- Modify: `backend/app/models.py` (tabla `password_resets`), `backend/app/schemas.py`, `backend/app/routers/auth.py`, `backend/app/config.py`, `frontend/src/Router... router.tsx`, `frontend/src/pages/AdminLogin.tsx`, `frontend/src/api/client.ts`
- New pages: `frontend/src/pages/RecuperarPassword.tsx`, `frontend/src/pages/RestablecerPassword.tsx`
- Test: `backend/tests/test_recuperar.py`

**Interfaces:**
- Produces: modelo `PasswordReset(id, admin_id FK admin_users, token_hash String(255) unique, expira_en DateTime, usado Boolean default False, created_at)` (tabla nueva — la crea `create_all`, sin micromigración). `emails.enviar_email(asunto: str, cuerpo: str, destinatarios: list[str]) -> None` (smtplib STARTTLS, settings `smtp_host` `smtp_port` `smtp_user` `smtp_pass` `email_from`). Settings suma: `smtp_host=""`, `smtp_port=587`, `smtp_user=""`, `smtp_pass=""`, `email_from=""`, `frontend_url=""`, `recovery_emails=""`. Schemas: `RecuperarRequest(username: str)`, `RestablecerRequest(token: str, password_nueva: str)`. Endpoints públicos: `POST /api/auth/recuperar` (200 genérico siempre; 429 si excede ~3/min por instancia, rate-limit en memoria de `routers/auth.py`), `POST /api/auth/restablecer` (400 token inválido/usado/expirado o password <8).
- `password_nueva` min 8 en ambos; email con link `{settings.frontend_url}/restablecer-password?token=<token>`.

- [ ] **Step 1: Tests `test_recuperar.py`**: (a) username existente → 200 genérico + `enviar_email` mockeado (`monkeypatch.setattr("app.routers.auth.enviar_email", ...)` — auth lo importa de `app.emails`) recibe el email con el token URL; (b) username inexistente → 200 con el MISMO texto, sin email; (c) token válido + nueva ≥8 → 200, login con la nueva funciona, token reusado → 400; (d) token expirado (fila con `expira_en` en el pasado) → 400; (e) token inexistente → 400; (f) nueva con 7 chars → 400; (g) 4 llamadas seguidas → la 4ª responde 429.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar backend**: modelo + `emails.py` + endpoints. Token hash: `hashlib.sha256(token.encode()).hexdigest()`. Rate limit: dict de módulo `{ip: lista_de_timestamps}`, limpiar >60s, ≥3 → 429. Recuperar: buscar admin por `username` — si existe, crear fila + enviar email; RESPUESTA idéntica siempre: `{"detail": "Si el usuario existe, se envió un email a los contactos registrados."}`. Restablecer: validar → cambiar `password_hash` → `usado=True`; email también avisa a `RECOVERY_EMAILS` que la password cambió (opción: asunto "Se cambió la contraseña", cuerpo corto).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Frontend**: `client.ts` suma `recuperarPassword(username) -> {"detail": string}` y `restablecerPassword(token, nueva) -> {"detail": string}` (públicos, sin auth). `AdminLogin.tsx`: borrar línea "Demo: admin / admin123"; link "Olvidé mi contraseña" → `/recuperar-password`. `RecuperarPassword.tsx`: form username → POST → texto genérico. `RestablecerPassword.tsx`: lee `?token`, form nueva + repetir → POST → mensaje + link al login. `router.tsx`: rutas públicas nuevas.
- [ ] **Step 6: `npm run build`** → limpio.
- [ ] **Step 7: Suite completa** → PASS.
- [ ] **Step 8: Commit** `feat: recuperacion de contrasena por email (password_resets)`

### Task 5: Modales propios + limpiezas UI

**Files:**
- Create: `frontend/src/components/Modal.tsx`
- Modify: `GestionProductos.tsx` (4 diálogos), `Combos.tsx` (borrar combo), `GestionPedidos.tsx` (cancelar pedido; placeholder del input "Otro" → vacío), `AdminGaleriaImagenes.tsx` (borrar foto)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `ConfirmModal({ titulo: string; mensaje: string; textoConfirmar?: string; peligroso?: boolean; onConfirmar: () => void; onCancelar: () => void })` y `ModalInput({ titulo: string; mensaje: string; inicial: string; onConfirmar: (valor: string) => void; onCancelar: () => void })` — overlay con Esc/click-fuera = cancelar, Enter = confirmar, estilo del tema (`bg-negro-panel`, borde `negro-borde`, `ConfirmModal` en rojo con `peligroso`).

- [ ] **Step 1: `Modal.tsx`** con los dos componentes (overlay fixed z-50, cerrar con Esc listener y click en backdrop, Enter confirma, ModalInput con input prellenado + autoFocus).
- [ ] **Step 2: Reemplazar los 7 diálogos**: cada página mantiene state `{tipo: "..." | null}` para saber cuál modal está abierto (patrón: `const [modal, setModal] = useState<{...} | null>(null)`); la acción que hoy corre `confirm()/prompt()` se ejecuta en `onConfirmar`. `GestionProductos` — borrar producto, borrar categoría, oferta (`ModalInput` numérico, misma validación que hoy), renombrar categoría; `Combos` — borrar combo; `GestionPedidos` — cancelar pedido + placeholder vacío; `AdminGaleriaImagenes` — borrar foto con `ConfirmModal`.
- [ ] **Step 3: `GestionPedidos.tsx`** placeholder "Otro" → `""` (y solo hay 1 más: verificar con grep `confirm("|prompt(` → 0 resultados).
- [ ] **Step 4: `npm run build`** → limpio + grep de verificación.
- [ ] **Step 5: Commit** `feat: modales propios para confirmaciones y prompts del panel admin`

### Task 6: Configuración de producción + docs

**Files:**
- Modify: `.env.example` (completo con TODAS las vars del spec, prod y dev), `README.md` (sección Deploy actualizada con la tabla de vars + pasos), `ESTADO-PROYECTO.md` (estado real)
- Create: `backend/vercel.json` (`{"builds": [{"src": "app/main.py", "use": "@vercel/python"}], "routes": [{"src": "/api/(.*)", "dest": "app/main.py"}]}`-equivalente simple: incluir `tests/` en `excluded` (ver spec §1)

**Interfaces:** Ninguna nueva (documentación).

- [ ] **Step 1: `backend/vercel.json`** mínimo que excluye `tests/` del bundle (ver spec §1).
- [ ] **Step 2: `.env.example`** — sumar todas las vars de las tareas 1–4 (Blob, SMTP, recovery, admin) marcadas "solo prod" vs "prod+dev".
- [ ] **Step 3: README (sección Deploy) + ESTADO-PROYECTO** — reemplazar el apartado de deploy con los pasos del spec §6 (Neon → backend → init_db+seed → frontend → smoke test), y quitar toda mención de `admin/admin123` como credenciales válidas.
- [ ] **Step 4: Commit** `docs: configuracion de prod, vercel.json y runbook de deploy`

### Task 7: Runbook de deploy (manual — el dueño/dev ejecuta)

No es código: checklist final con comandos exactos, extraída del spec §6:

- [ ] Crear proyecto **Neon** → copiar `DATABASE_URL` (cadena pooled).
- [ ] `openssl rand -hex 32` → `JWT_SECRET`.
- [ ] Vercel projet **backend** (Root: `backend/`): env vars del spec §2 (backend), vincular Blob store → genera `BLOB_READ_WRITE_TOKEN`. Verificar `GET /api/health`.
- [ ] Desde la máquina local: `DATABASE_URL=<neon>` `ADMIN_USERNAME/ADMIN_PASSWORD=<suyo>` → `.venv\Scripts\python -m app.init_db && .venv\Scripts\python -m app.seed`.
- [ ] Vercel projet **frontend** (Root: `frontend/`): `VITE_API_URL`, `VITE_WA_NUMBER`.
- [ ] Smoke test del spec §6 paso 6 (tienda → login → cambio de contraseña → subir foto (URL Blob) → pedido WhatsApp → dashboard → recuperación completa).
- [ ] El dueño completa Ajustes y carga productos reales.