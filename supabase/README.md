# Supabase opcional

El juego conserva progreso, coins y desafíos locales sin Supabase. La cuenta recuperable, wallet online y rankings con premios requieren activar V2. No hacen falta credenciales para ejecutar los tests o generar el build.

La [guía de integraciones](../docs/INTEGRATIONS.md) reúne el paso a paso de Supabase, Netlify Functions, Google H5 y PayPal. No se aplicó ninguna migración a un proyecto remoto durante esta implementación.

## Configuración y migraciones

1. Crear un proyecto Supabase de pruebas. Habilitar **Anonymous Sign-ins**, proveedor **Email** y **Allow manual linking**. Configurar Site URL y redirects del entorno. Incluir `{{ .Token }}` en las plantillas Magic Link y Change Email; probar entrega con SMTP. La vinculación usa OTP `email_change`; la recuperación de una cuenta existente usa `email`.
2. Aplicar solamente las migraciones pendientes, en este orden:
   - [V1: perfiles, resultados y desafíos](migrations/20261003021023_tower_backend.sql).
   - [V2: economía, tickets, rankings y pagos](migrations/20261003200135_tower_economy_v2.sql).
3. Respaldar un proyecto con datos y comprobar su historial antes de aplicar SQL. No repetir una migración existente. Los archivos se crearon con `supabase migration new` usando CLI 2.119.0; no equivalen a una migración aplicada en producción.
4. Mantener `public` en Data API y dejar `tower_private` y `tower_economy` fuera de los schemas expuestos. Verificar grants, RLS y Database Advisors en el proyecto real.
5. Configurar Build en Netlify y reconstruir:

```dotenv
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TU-CLAVE-PUBLICA
VITE_SERVER_ECONOMY_ENABLED=false
VITE_SERVER_RANKINGS_ENABLED=false
VITE_RANKING_PERIODS=daily
VITE_PAYPAL_ENABLED=false
```

`VITE_SUPABASE_PUBLISHABLE_KEY` tiene prioridad; `VITE_SUPABASE_ANON_KEY` es compatible cuando no se usa publishable. La URL debe ser HTTPS, sin credenciales, query, fragmento ni ruta de API; HTTP solo se admite en localhost. El cliente rechaza claves secretas y JWT con otro rol, pero cualquier `VITE_*` se incorpora al frontend: nunca incluir `service_role`, `sb_secret_...`, contraseñas ni access tokens. [Claves públicas](https://supabase.com/docs/guides/api/api-keys).

La economía también requiere variables con alcance **Functions**, sin prefijo `VITE_`:

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=SECRETO_SOLO_SERVIDOR
APP_URL=https://TU-SITIO.netlify.app
REPLAY_WORKER_SECRET=SECRETO_ALEATORIO_DISTINTO
SERVER_ECONOMY_ENABLED=false
SERVER_RANKINGS_ENABLED=false
SERVER_RANKING_PERIODS=daily
SERVER_AD_REWARDS_ENABLED=false
SERVER_PAYPAL_ENABLED=false
SERVER_OBJECT_CATALOG=extended-24
```

`SUPABASE_SERVICE_ROLE_KEY` es el fallback legacy del secreto. No guardar estos valores en Git, `netlify.toml`, HTML, logs ni assets. Usar proyectos y secretos distintos en pruebas y producción. Vite dev/preview no ejecuta Netlify Functions.

## Activación por etapas

| Etapa | Flags | Comprobación antes de ampliar |
| --- | --- | --- |
| Cuenta y wallet | `VITE_SERVER_ECONOMY_ENABLED=true`, `SERVER_ECONOMY_ENABLED=true` | OTP real en dos navegadores, starter único, inventario y replay alojado |
| Ranking diario | Ambos flags `SERVER_RANKINGS_ENABLED` / `VITE_SERVER_RANKINGS_ENABLED` en `true`; ambos períodos en `daily` | Cierre UTC, desempates y premios idempotentes |
| Semanal | Ambos períodos en `daily,weekly` | Mejores cinco días, mínimo tres y cierre semanal |
| Mensual | Ambos períodos en `daily,weekly,monthly` | Mejores veinte días, mínimo diez y cierre mensual |
| Anuncios online | `SERVER_AD_REWARDS_ENABLED=true` | Aprobación H5, CMP real y decisión explícita sobre callbacks falsificables |
| Compra de coins | `SERVER_PAYPAL_ENABLED=true`, `VITE_PAYPAL_ENABLED=true`, sandbox inicialmente | Precio, Merchant ID, captura, webhook y devoluciones reales de prueba |

Los nombres de los períodos son `SERVER_RANKING_PERIODS` y `VITE_RANKING_PERIODS`. Mantener los demás flags apagados durante cada etapa. Google y PayPal tienen configuración adicional en la [guía](../docs/INTEGRATIONS.md); habilitar un flag no demuestra aprobación del proveedor.

## Acceso y compatibilidad

V1 conserva sus RPC y datos. Las tablas `profiles`, `scores`, `daily_scores` y `challenges` tienen RLS y SELECT propio; el navegador escribe únicamente mediante RPC autorizadas que usan `auth.uid()`. Los wrappers públicos son `SECURITY INVOKER`; sus implementaciones viven en `tower_private` con `SECURITY DEFINER`, `search_path=''` y permisos explícitos. Las lecturas públicas devuelven pseudónimos, alturas y desafíos, sin UUID, sesión o JSON privado del perfil.

V2 mantiene once tablas con RLS dentro de `tower_economy`: wallet, inventario, ledger, límites diarios, tickets, usos de ayudas, cosméticos, anuncios, períodos, órdenes y eventos de pago. `anon` y `authenticated` no tienen acceso directo ni EXECUTE de `public.tower_account_api`. Ese wrapper y las funciones privadas son `SECURITY INVOKER` y se reservan a `service_role` desde Functions. La migración concede explícitamente acceso a `auth.users(id,email,email_confirmed_at)` para las verificaciones del servidor; no necesita leer contraseñas.

La Function valida el bearer con Supabase Auth y obtiene allí el propietario. El body no elige usuario ni puede solicitar acciones privadas de acreditación. Un usuario anónimo tiene rol Postgres `authenticated`; ese rol no demuestra email verificado. [Auth anónima](https://supabase.com/docs/guides/auth/auth-anonymous).

El wallet anónimo empieza en cero. El starter de 100 coins se acredita una vez al confirmar email, conservando el mismo UID. Compras, inventario, tickets y recompensas online requieren cuenta recuperable. Recuperar esa cuenta en otro navegador recupera wallet e inventario; no importa ni fusiona coins locales. `sync_profile` de V1 continúa como respaldo privado del perfil local y no autoriza créditos V2.

El público mínimo es 13 años; las funciones online de adolescentes requieren autorización del adulto responsable. Edad y tutela son autodeclaraciones, no verificaciones. Compras y publicidad se restringen a adultos. Completar la revisión legal y de consentimiento antes de monetizar.

## Recompensas y verificación del juego

- Base de partidas, récord personal y duplicación comparten un límite de 300 coins por día UTC. Récord: hasta 10 coins una vez por día; duplicación: solo la base de esa partida.
- Misiones: hasta 25 coins diarios fuera de ese límite. Bono publicitario: 25 coins, hasta tres al día, también aparte.
- Máximo dos ayudas distintas por torre; Guía 5 y Guía 10 son excluyentes. Se reservan al crear ticket y se consumen únicamente al autorizar su activación. El replay debe coincidir con los usos y ticks registrados.
- V2 permite ayudas autorizadas, incluyendo cambio de pieza y segunda oportunidad, en rankings. V1 conserva la exclusión de partidas asistidas. Los resultados y reglas de ambas versiones no se mezclan.
- Daily requiere al menos cinco objetos y email confirmado. Semanal suma los cinco mejores días; mensual, los veinte mejores. Los premios dependen de participantes elegibles y se acreditan desde servidor una sola vez.
- Ticket: 60 minutos reales y hasta 40 activos. El servidor fija seed, catálogo y reglaset; el catálogo Daily queda congelado. La publicación debe preservar el contrato físico de ese reglaset.
- El cliente envía eventos y tick final; `replay-background` reproduce la simulación compartida antes de aceptar métricas. Los resultados empiezan pendientes. Un fallo de infraestructura excluye el intento y devuelve una vez las ayudas pagadas efectivamente consumidas.
- Cierre de períodos: 75 minutos después del fin UTC. `settle` despacha cada cinco minutos los workers protegidos `replay-background` y `settle-background`. Cada liquidación procesa hasta tres períodos, cien timeouts y cien tickets vencidos; los premios de un período se guardan atómicamente y no se duplican al reintentar.

Consultar las reglas completas en `/reglas-ranking/` y el [plan por etapas](../docs/ROADMAP.md). Los callbacks de Google H5 no son comprobantes SSV firmados: un cliente modificado puede falsificarlos. El flag de recompensas publicitarias online permanece apagado hasta aceptar y documentar ese riesgo.

PayPal fija packs y precios en servidor. La captura canónica validada puede acreditar coins; el webhook verificado usa el mismo identificador para conciliación idempotente. Las devoluciones revierten coins de forma proporcional y pueden dejar deuda; nuevas ganancias reducen esa deuda. Live requiere aprobación separada además de los flags habituales. No se comprobaron pagos reales.

## Fallos y límites de seguridad

El juego local continúa cuando Auth, cuenta, anuncios o pagos no responden. No concede créditos online optimistas. Las solicitudes y Auth tienen límites de espera; la activación de ayudas reintenta con el mismo identificador para recuperar una respuesta perdida. No se garantiza una operación online sin conexión.

V1 solo valida rangos, coherencia y límites por identidad; un cliente modificado puede inventar resultados compatibles. V2 comprueba el resultado físico de los eventos, pero no identifica personas ni impide bots, cuentas múltiples o búsqueda automatizada. No constituye anti-cheat completo. Configurar límites reales de Auth y evaluar protección contra abuso antes de abrir premios o compras.

## Verificación local y pendientes

El 3 de octubre de 2026, con Node 24.19.0 y PGlite 0.3.14, se aprobaron **99 comprobaciones SQL: 25 V1 + 74 V2**. V1 cubre RPC, límites, RLS por propietario y lecturas públicas. V2 cubre wallet, ledger inmutable, idempotencia, límites, ayudas, premios, cierres por lotes, pagos fuera de orden y permisos de Auth. El fixture V2 no concede SELECT general sobre `auth.users`: permite solo las tres columnas necesarias y comprueba que contraseñas, SELECT general y accesos de `anon`/`authenticated` fallen.

Son bases efímeras con roles, Auth y resultados aceptados de prueba. Los tests unitarios también simulan Auth y APIs de pago. Esto no verifica Supabase Auth HTTP, entrega de emails, Data API, aislamiento de sesiones alojadas, RPC reales, cron de Netlify, anuncios reales ni PayPal sandbox/live.

Antes de activar V2, comprobar en el proyecto real dos cuentas recuperables y una sesión anónima: aislamiento de perfiles y operaciones, rechazo de owner ajeno y RPC privadas, permisos de columnas Auth, carrera/reintento de compras y ayudas, replay, liquidación y devoluciones. Registrar entorno, fecha y resultado por separado; la implementación y los tests locales no sustituyen esa comprobación.

Para repetir SQL sin credenciales ni Docker, desde la raíz del juego:

```bash
npm install --prefix /tmp/tower-db-check --no-audit --no-fund @electric-sql/pglite@0.3.14
TOWER_PGLITE_MODULE=/tmp/tower-db-check/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/backend.contract.mjs
TOWER_PGLITE_MODULE=/tmp/tower-db-check/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/economy.contract.mjs
```

Usar Node 22.12 o posterior. Los scripts no se conectan a Supabase ni agregan dependencias al juego.
