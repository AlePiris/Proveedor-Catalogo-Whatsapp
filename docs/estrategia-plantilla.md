# Estrategia: El Gordito como plantilla comercial

> **Documento de contexto estratégico** — no es documentación técnica del código,
> es el *panorama* de hacia dónde va este proyecto. Fecha de la conversación que
> lo originó: **2026-08-31**. Leerlo al retomar el trabajo.

---

## 1. El cambio de visión

Hasta acá, El Gordito era un proyecto de facultad: FastAPI + React para una
pizzería. **La visión nueva es otra:**

> Este sitio es el **ejemplo/demo** de una plantilla. El plan es venderla con
> **pago único** a otros clientes: mismo backend, misma base de datos (mismo
> diseño, otros datos), mismas funcionalidades — solo cambia la "piel" del
> front (logo, colores, tipografías, textos) según el gusto de cada cliente.

Esto **cambia el criterio de todas las decisiones técnicas**: ya no se decide
por "alcanza para la facultad", se decide por "¿escala bien cuando haya 3, 5,
10 clientes corriendo esto?".

---

## 2. La regla que cambia todo

> **Cada deuda de diseño que quede hoy cuesta × número de clientes vendidos.**

Con 0 clientes, recrear tablas / refactorizar es gratis. Con 5 clientes
corriendo, es una pesadilla de migraciones. **Ahora es el momento barato.**

---

## 3. El modelo de negocio (validado contra el mercado)

Lo que describes existe y es un modelo probado:

1. **Agencia/estudio web de nicho** — exactamente este plan: mismo motor,
   cara distinta por cliente, pago único por instalación. Es el 90% del
   freelance/agency, y el nicho "restaurantes / carta digital / pedidos por
   WhatsApp" es justamente este producto.
2. **Plantillas de mercado** (WordPress, ThemeForest) — el vendedor hace UN
   template y lo vende mil veces. Nuestro modelo es más la agencia que usa el
   motor: cobramos personalización + instalación.
3. **El competidor real: SaaS de carta digital** (TiendaNube, apps de menú QR
   con pedidos por WhatsApp). Cobran suscripción mensual.

**Posicionamiento propio:** "sin abono mensual, el sitio es tuyo" — buena
ventaja de venta; desventaja honesta: ellos cobran todos los meses, nosotros
una vez. Por eso el modelo sano es **pago único + cuota de mantenimiento
opcional**.

---

## 4. La decisión técnica más importante: copiar vs desplegar

**❌ Frágil (NO):** copiar la carpeta del proyecto por cada cliente. A la
tercera venta pasás más tiempo replicando bugs entre copias que vendiendo, y
las copias divergen ("al cliente 2 le modifiqué a mano...").

**✅ Correcto (SÍ):** **UN solo repositorio, N despliegues.**

- Un único código: el backend intacto; el front con la "piel" configurable
  (logo, colores, tipografías, textos — todo desde configuración, nada
  hardcodeado).
- Cada cliente = su propio deploy (su Vercel + su Neon) con su `.env` y su
  configuración de tema.
- Bug encontrado en un cliente → se arregla UNA vez en el repo → se
  redespliega a todos.

No hace falta multi-tenant ni SaaS para esto. La palabra clave es
**"despliegue"**, no **"copia"**.

---

## 5. Radiografía honesta de la base de datos actual

### Lo que ya es nivel plantilla (no se toca)
- **Snapshot en `pedido_items`**: copias de nombre y precio al momento del
  pedido (lo que hacen los e-commerce reales).
- **Combos transaccionales sin stock propio**: el stock efectivo se calcula
  del stock real de los componentes; descuento/reintegro exacto.
- **Reglas de negocio SOLO en el backend**: el cliente nunca manda precios,
  el total se recalcula siempre, el stock se valida en el servidor.
- `local_config` singleton + 7 tablas que cubren el dominio sin
  sobre-ingeniería.

### La deuda que SÍ se paga ahora (era "ok para facultad", no para plantilla)
1. **Categorías con FK** (`categoria_id`) en vez de match por nombre — el
   match por string es una bomba con dueños que no saben nada.
2. **Elecciones como tabla** (`pedido_item_elecciones`) en vez de JSON en
   TEXT — no consultable con SQL, sin integridad referencial.
3. **CHECK constraints** en `estado`, `tipo_entrega`, `metodo_pago` — la DB
   se defiende sola contra datos basura.

### Lo descartado conscientemente (queda documentado como trade-off)
- Tabla de movimientos de stock (audit trail): best practice, pero complejidad
  que un dueño de pizzería nunca miraría. Reconsiderar si algún cliente la
  pide.

---

## 6. Hoja de ruta técnica (en orden de apalancamiento)

1. **Branding a configuración** — habilita TODO el modelo: colores, logo,
   nombre, textos → tabla de tema / variables de entorno. Sin esto no hay
   plantilla. Incluye revisar defaults hardcodeados ("Pizzería El Gordito").
2. **Deuda de DB (sección 5):** FK de categorías + elecciones como tabla +
   CHECKs. Tocan lo mismo que Alembic, conviene hacerlos juntos.
3. **Alembic** — migraciones versionadas en vez de micromigraciones. Cuando
   haya clientes, `alembic upgrade head` en cada instalación.
4. **API versionada `/api/v1`** — si el front es intercambiable, la API es el
   contrato. El prefijo permite evolucionar sin romper instalaciones.
5. **Precios en centavos (Integer)** — eliminar el riesgo de redondeo float
   de JS para siempre (estándar Stripe).
6. **Timestamps con zona horaria** + ISO 8601 (ya mordió una vez el análisis
   por días).
7. **Script de seed** (`python -m app.seed_db`) — menú completo + pedidos de
   ejemplo + admin. Imprescindible para demos de venta en 2 minutos.
8. **Demo siempre encendida** — el vendedor 24/7.
9. **Docs de dos audiencias** — técnica (OpenAPI de FastAPI personalizado,
   doc de DB ya en `docs/base-de-datos.md`) + manual del dueño.
10. **Personalizar `/docs` (OpenAPI)** — es la carta de venta de la API.

---

## 7. Puntos de negocio pendientes (no técnicos)

- **Quién paga el hosting:** pago único + yo pagando Vercel/Neon de 5 clientes
  = regalar plata. Opciones: (a) deploy en cuentas del cliente (le entrego
  credenciales), (b) **mantenimiento anual que cubra hosting + fixes** (la
  más común y sana).
- **Qué compra el cliente exactamente** (contrato): la instalación funcionando
  + ¿el código fuente? ¿puede modificarla? ¿puede revenderla? Si entrego el
  repo, deja de ser plantilla exclusiva. Muchos venden "instalación + uso",
  no el código.
- **El pago único incluye instalación + configuración inicial** (que quede
  andando), no solo archivos.
- **Licencia clara antes de la primera venta** — los malentendidos acá son la
  principal fuente de conflictos.

---

## 8. Estado al día de la fecha

- Backend + frontend funcionando local (uvicorn 8800, Vite 5173), SQLite dev,
  target Vercel + Neon.
- Combos con grupos a elección terminados y probados (mezcla de gustos, stock
  selectivo, reintegro exacto).
- `docs/base-de-datos.md` escrito (documentación de DB para la entrega).
- **Este documento** = el punto de partida de la próxima sesión: el primer
  ítem de la hoja de ruta (branding a configuración) es el siguiente paso
  recomendado.