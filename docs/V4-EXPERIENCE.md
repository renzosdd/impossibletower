# UX y economía V4

La interfaz conserva la paleta, las tipografías y la física V3. El nuevo flujo va de jugar o confirmar una compra a `/api/account`, luego a operaciones transaccionales de Supabase y de vuelta al saldo, inventario y resultado correspondientes. Los overlays siguen siendo HTML/CSS sobre Phaser.

## Cambios de producto

- Idioma solo en Ajustes; preferencia guardada, luego primer ES/EN del navegador, inglés como alternativa.
- Inicio con copa y récord Daily actual, vidas independientes y renovación UTC. Recargar no inicia una partida. Daily tiene capa de carga; repetir el toque no emite más tickets.
- Resultado con altura separada del mensaje, monedas exclusivamente de las misiones aceptadas para ese ticket y estado pendiente breve. Sin toast de monedas ni textos permanentes de verificación.
- Perfil con identidad, inventario, invitaciones, actividad y privacidad/cierre de sesión agrupados. Las insignias tienen pantalla propia.
- Tienda con Ayudas/Estilos/Fondos/Monedas, información contextual y confirmación de todo gasto. Equipar no cobra ni pide confirmación. Monedas reúne formas de ganar, códigos y packs.
- Cinco misiones de dos monedas, máximo diez por cuenta Google/día UTC. Invitados ven progreso sin cobrar; la renovación no implica regeneración gradual de vidas.
- Catálogo de insignias 2: doce familias y treinta y seis niveles. Bronce reconoce; Plata y Oro entregan premios reclamables una vez, máximo noventa monedas por cuenta más ayudas finitas.
- Ayudas sin preparar: dos distintas, una vez cada una; guías excluyentes activables durante la partida por los próximos cinco/diez lanzamientos. Segunda chance ocupa un lugar y puede comprarse por noventa con confirmación.
- Daily Hoy/Semana/Histórico y práctica mensual. Semana suma los tres mejores días, requiere veinte cuentas Google y paga 60/40/20, diez para 4–10 y cuatro para 11–25. Emisión máxima 250/semana. Se guardan felicitaciones provisionales y definitivas, con reconocimiento de falta de mínimo.

## Migración y compatibilidad

`supabase/migrations/20261008135602_tower_v4_experience.sql` es una migración nueva, sin modificar las migraciones publicadas. Su timestamp se generó localmente porque la CLI Supabase no estaba instalada.

1. Aplicar primero en una base aislada después de todas las migraciones V3.
2. Comprobar `tower_economy.release_settings.weekly_start`: se fija al **lunes UTC siguiente** al momento de aplicación. No habilita premios retroactivos.
3. Insignias y sus contadores empiezan en cero tanto en el estado económico como en los guardados de `public.profiles`. Se conservan wallets, compras, inventario y récords V3. Un `sync_profile` antiguo conserva los campos del catálogo nuevo y no restaura catálogo 1. Los datos locales anteriores a V3 no contribuyen al récord mostrado.
4. Períodos ya abiertos conservan `economic_rules`; los liquidados no se recalculan. Los podios que se cierren después del reset cuentan para el catálogo nuevo, incluidos períodos abiertos. Los períodos nuevos guardan reglas V4; Hoy ya no paga monedas. La semana nueva solo se crea a partir de `weekly_start`.
5. Tickets existentes mantienen `aid_rules_version=1` y `economy_version=3`. Los nuevos usan ayudas 2 y economía 4. El worker obtiene la versión del ticket; ningún cliente puede elegir la física o las reglas económicas del servidor. El replay verifica los consumos autorizados y su tick exacto.
6. Reclamos, canjes y consumos usan claves únicas y ledger idempotente. La liquidación espera 75 minutos y las clasificaciones diarias. Bloquea wallets en orden para evitar inversiones con los pagos de referidos.

Las tablas económicas tienen RLS y no conceden lectura/escritura a `anon` ni `authenticated`. Los RPC económicos y de administración solo pueden ejecutarse con `service_role`. La cuenta Auth y sus identidades verificadas se comprueban en el servidor; un perfil local no acredita monedas ni premios. Los contratos comprueban acceso permitido y denegado, siguiendo la [guía de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Configuración de lanzamiento

Mantener las claves privadas fuera de Vite y del repositorio. Para habilitar las cuatro vistas usar ambos:

```text
VITE_RANKING_PERIODS=daily,weekly,all-time,monthly
SERVER_RANKING_PERIODS=daily,weekly,all-time,monthly
```

Los flags `VITE_SERVER_ECONOMY_ENABLED`/`SERVER_ECONOMY_ENABLED` y `VITE_SERVER_RANKINGS_ENABLED`/`SERVER_RANKINGS_ENABLED` conservan su función. Una actualización de flags Vite requiere reconstruir. El cron de liquidación y el worker de replay deben estar operativos; mantener su secreto separado por entorno.

Se puede desactivar PayPal con `SERVER_PAYPAL_ENABLED=false` sin interrumpir las partidas; desactivar también `VITE_PAYPAL_ENABLED` y reconstruir oculta la disponibilidad en tienda. Los anuncios dependen del proveedor, sus flags y consentimiento actuales; este cambio no habilita anuncios por sí solo.

## Campañas promocionales internas

Herramienta: `scripts/promotions.mjs`. El operador carga la clave administrativa desde un entorno privado. No entregar esa clave a empresas, jugadores ni al frontend.

Archivo de campaña de ejemplo:

```json
{
  "company": "Empresa de ejemplo",
  "code": "EMPRESA-26",
  "coins": 10,
  "startsAt": "2026-10-12T00:00:00Z",
  "expiresAt": "2026-10-19T00:00:00Z",
  "maxRedemptions": 100
}
```

```bash
node scripts/promotions.mjs create campaign.json --dry-run
node scripts/promotions.mjs create campaign.json
node scripts/promotions.mjs list
node scripts/promotions.mjs pause EMPRESA-26
node scripts/promotions.mjs resume EMPRESA-26
```

`--dry-run` valida y muestra emisión máxima sin contactar Supabase. Cupo y vigencia son obligatorios. Las operaciones usan `public.tower_promo_admin`; crear una campaña es una acción administrativa explícita. Canjear exige Google, una vez por cuenta/campaña, cupo bajo bloqueo y acreditación en la misma transacción. Los códigos inválidos también consumen el límite de diez intentos/minuto; los reintentos de un canje acreditado no duplican ni consumen cupo.

Antes de publicar una campaña, comparar `coins * maxRedemptions` con el presupuesto promocional; no se puede prometer una emisión abierta. Pausar detiene canjes nuevos, conservando los ya realizados.

## PayPal

El repositorio implementa orden, aprobación, retorno, captura, firma de webhook, reembolso parcial y reversión. Packs: 200/USD 2.99, 600/USD 6.99, 1400/USD 12.99. Confirmación de adulto y pack antes del checkout. El servidor usa el precio del catálogo y verifica destinatario, importe, USD, orden y captura canónicos. Repetir captura/webhook no duplica; un reembolso recibido primero se concilia; reversión y gasto previo pueden dejar un saldo contable negativo.

Cancelar no acredita. Un retorno sin sesión guarda el ID y pide recuperar la cuenta Google; un pago pendiente conserva la opción **Reintentar pago**. El estado final distingue completado, reembolsado y revertido. El webhook puede acreditar aunque el navegador no vuelva.

Variables privadas por entorno: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENVIRONMENT`, `APP_URL`; habilitación `SERVER_PAYPAL_ENABLED`. Variables públicas: `VITE_PAYPAL_ENABLED`, `VITE_PAYPAL_ENVIRONMENT`.

Live exige además `SERVER_PAYPAL_LIVE_APPROVED=true` y requisitos efectivamente cumplidos: cuenta Business, credenciales Live, webhook Live y aprobación previa del proveedor. La [política de PayPal](https://www.paypal.com/us/legalhub/paypal/acceptableuse-full) incluye monedas virtuales de juegos entre actividades sujetas a aprobación. Un flag no acredita haber obtenido esa aprobación.

**Pendiente externo:** no se proporcionaron credenciales Sandbox aisladas ni aprobación Live. La cuenta Supabase conectada muestra solo el proyecto principal y su rama `main`; no hay staging aislado verificado. Los tests locales simulan las respuestas del proveedor; no equivalen a una transacción Sandbox real. No se desplegó esta migración a producción ni se realizaron cargos. La compra Live de comprobación la realiza el titular después de superar Sandbox y los requisitos del proveedor.

## Verificación reproducible

Node >=22.12:

```bash
npm run check
npm test
npm run test:db
npm run test:e2e
npm run build
```

Los contratos V3 se ejecutan contra el esquema histórico; los V4 aplican todas las migraciones y además preparan compras, récords y tickets previos para comprobar preservación. PGlite serializa su conexión: las pruebas simultáneas de canjes prueban idempotencia, pero la carrera real del último cupo debe verificarse también con conexiones independientes en staging.

La suite de navegador verifica móvil/escritorio, pantalla corta, idioma, confirmación/cancelación, foco contenido/Escape, tienda, perfil, barras, insignias y replay físico a distintos FPS. Los diálogos nativos mantienen foco según el [patrón WAI](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Las capturas se guardan en `artifacts/` o `test-results/`, ambos ignorados por Git.

Las pruebas con cuenta usan el servidor Vite con configuración **ficticia** y `/api/account` interceptado, evitando usuarios y compras reales. Ejecutar un segundo servidor con URL `https://tower-test.supabase.co`, clave pública ficticia, economía/rankings habilitados y `VITE_RANKING_PERIODS=daily,weekly,all-time,monthly`; luego:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5190 PLAYWRIGHT_ACCOUNT_ENABLED=1 npx playwright test tests/e2e/account-and-simulation.spec.ts
```

### Validación pendiente de staging

- Configurar Supabase, Google OAuth, Netlify Functions, worker y cron aislados. Aplicar migraciones; comprobar que `weekly_start` es el lunes previsto.
- Recorrer UI → Functions → Postgres → UI con dos cuentas; verificar gastos cancelados, doble clic, ayudas a mitad de partida y rechazo de una tercera; renovación UTC y diez monedas por misiones.
- Confirmar reclamación única, sincronización de cliente antiguo, participantes 19/20, tres mejores días y desempates, cierre de Daily antes de semana y notificaciones al volver.
- Desde conexiones distintas competir por el último cupo de campaña; verificar una acreditación y una respuesta agotado. Repetir el request ganador.
- Sandbox real: aprobar y capturar, retorno sin sesión, cancelar, medio rechazado, pendiente, webhook repetido, reembolso parcial/total y reversión. No usar cuentas, credenciales ni saldo de producción.
- Revisar emisión/gastos con `supabase/reports/v4-economy.sql`, presupuestos de campañas y ausencia de saldo duplicado. Desactivar compras como ensayo sin detener el juego.

La entrega V4 sustituye los apartados de UX/economía/pagos de V3; `docs/V3-LAUNCH.md` conserva el registro histórico del lanzamiento anterior.

### Resultado de validación local

TypeScript y build de producción correctos. Pasaron 311 tests unitarios y 43 contratos SQL (25 históricos V3 y 18 V4). Los 105 casos de navegador habilitados se verificaron en móvil y escritorio: suite general, cuenta con API simulada, pantallas V4, cancelación/retorno/reintento de pagos y PWA de producción/offline. Los casos de proveedores reales continúan condicionados a su configuración. En este equipo algunos recorridos físicos y de actualización necesitaron ampliar el timeout; las repeticiones pasaron sin cambiar la física.
