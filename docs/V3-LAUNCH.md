# V3: operación y lanzamiento

Esta entrega se valida localmente antes de habilitar competencia. No activar anuncios, compras ni eventos de producción usando las respuestas simuladas de los tests.

## Contratos implementados

- `objectForRules` conserva V2 y aplica V3 a tickets nuevos. Primeros ocho objetos con apoyo estable, fricción mayor, rebote menor, masa y centro de masa moderados. Los cuerpos siguen siendo dinámicos. Cada caída por debajo de la zona pierde; no se usa el antiguo detector de balanceo/colapso significativo en V3.
- Una segunda chance por intento restaura cuerpos, velocidades, fuerza, giro y estado de reposo, altura, puntaje, cursor y cámara anteriores al último lanzamiento. Conserva reloj activo, lanzamientos y cuotas consumidas de ayudas para impedir prolongar tickets o reutilizar guías. Nunca recupera un timeout. Los resultados recuperables son provisionales hasta elegir finalizar, reiniciar, compartir o salir.
- Google: OAuth PKCE con recuperación de sesión por Supabase. Vincular una identidad anónima usa `linkIdentity`; recuperar una cuenta usa `signInWithOAuth`. Identidades distintas cargan su propio perfil, sin fusionar saldos. `sync_profile` conserva metaprogreso; nunca acredita monedas ni publica resultados. El servidor decide elegibilidad leyendo Auth verificado e `auth.identities`.
- Un saldo en el ledger. Los perfiles locales se migran a `economyVersion: 3`, saldo local cero; cosméticos, insignias e historial permanecen. El saldo online no se toma del navegador.
- Daily: 3 gratuitos, 2 por anuncios completos como máximo, extras de 30 monedas sin cuota adicional. Se consumen al emitir ticket y vencen con el día UTC. Segunda chance cuesta 90. Dos ayudas distintas usadas máximo. Comprar segunda chance libera reservas no utilizadas si hace falta un lugar, conservando su inventario.
- Práctica verificada de invitados entra en mensual; Daily requiere Google. Ambos rankings admiten mínimo 5 objetos y una mejor entrada por identidad. Orden: altura, score, objetos, primera recepción, ID interno. Mensual no suma Daily; entrega insignia de podio.
- Bienvenida 60 una vez; misiones 2 cada una (máximo 6); referido 5 (máximo 10 pagos/día); Daily requiere 20 participantes y emite como máximo 125. Ninguna partida, récord, insignia, anuncio ni share entrega monedas por sí mismo.
- Atribución de referido: primer enlace válido, siete días, Google creado después de la atribución, primer Daily aceptado con 5 objetos. Se excluyen cuentas anteriores y autorreferidos. Después del décimo pago, el referido se descarta; no queda pendiente.
- PayPal deshabilitado por una constante de release, además de los flags. No se crean órdenes ni se procesan callbacks de pago. El código del proveedor queda para otra entrega.
- Inicio simplificado: Daily con tres corazones y Juego libre sin descripciones adicionales. Ranking está en la navegación inferior; las invitaciones tienen un botón separado. No se muestra contador de renovación, umbral de premios ni requisito Google en las tarjetas. Daily abre solo Google; práctica ofrece Google/invitado. Al agotar vidas, el botón Daily abre recarga por 30 monedas o anuncio disponible; una recarga confirmada inicia el intento. La renovación sigue siendo diaria en UTC, sin recarga gradual.
- ES por defecto; ES/EN persistente, disponible en menú, partida, resultado y diálogos. Las páginas públicas tienen versiones estáticas `/en/...`, sin scripts publicitarios.

## Pruebas locales reproducibles

Node >=22.12:

```bash
npm run check
npm test
npm run build
npm run test:e2e
npm run test:db
```

El contrato SQL usa PostgreSQL WASM/PGlite, con roles y Auth aislados y las cuatro migraciones. Las llamadas paralelas de esta conexión comprueban idempotencia, pero la concurrencia entre conexiones PostgreSQL reales se comprueba en staging. No usa el proyecto Supabase real. `@electric-sql/pglite` es una dependencia de desarrollo fijada; `npm ci` prepara el entorno. `TOWER_PGLITE_MODULE` permite sustituirla por un runtime externo si se necesita. La suite V2 sigue disponible como regresión de las primeras tres migraciones (`supabase/tests/economy.contract.mjs`).

Los tests normales de navegador fuerzan backend y publicidad deshabilitados. Para el circuito simulado de cuenta, levantar un Vite aparte con las siguientes variables públicas falsas y ejecutar solamente `account-and-simulation.spec.ts` contra ese servidor:

```bash
VITE_SUPABASE_URL=https://tower-test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test VITE_SERVER_ECONOMY_ENABLED=true VITE_SERVER_RANKINGS_ENABLED=true VITE_RANKING_PERIODS=daily,monthly npm run dev -- --port 5174
PLAYWRIGHT_ACCOUNT_ENABLED=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 npm run test:e2e -- tests/e2e/account-and-simulation.spec.ts
```

Estos tests interceptan Auth y API; no demuestran acceso Google real ni disponibilidad de anuncios reales.

### Resultado de la verificación local · 7 de octubre de 2026

- 296 tests unitarios aprobados en 18 archivos.
- 25 contratos SQL V3 aprobados, incluidos cuotas, idempotencia, misiones, referidos, premios con 19/20 participantes, reglas versionadas y permisos.
- Compilación de producción y comprobación TypeScript aprobadas.
- Pruebas de navegador aprobadas en escritorio y móvil: navegación, ES/EN, nombre obligatorio, reinicio, segunda chance con replay canónico, cuenta simulada, rankings, páginas legales y desafíos V2.
- PWA: práctica sin conexión y actualización desde el cliente anterior aprobadas en ambos dispositivos; la migración elimina las monedas locales y conserva el progreso.
- Ajuste del inicio: 24 casos distintos de navegador aprobados entre escritorio y móvil, incluidos corazones, acceso por modo, recarga única, saldo insuficiente, Google simulado después de privacidad, ES/EN, foco de teclado, Ranking y reinicio. La revisión visual incluye una ventana de 640 px de alto con el inicio completo sin scroll.

Quedan pendientes las comprobaciones externas de la sección siguiente: playtest humano, OAuth y proveedor publicitario reales, y transacciones concurrentes entre conexiones PostgreSQL en staging. Esta verificación no aplica migraciones ni activa competencia en producción.

## Activación en staging y producción

1. Hacer el playtest con **10 principiantes reales**. Registrar objetos colocados, caídas tempranas y tiempos; objetivo de mediana 8–12. Ajustar V3 **antes** de abrir eventos; una vez abierta la jornada, no alterar física ni catálogo sin nueva versión.
2. Aplicar `20261007221500_tower_v3_competition.sql` primero en staging con Supabase CLI. Revisar RLS, grants y ledger. Las tablas económicas son privadas; solo `service_role` ejecuta `tower_account_api`. No publicar secrets en Vite.
3. Configurar Google OAuth: consent screen, client ID/secret en Supabase y URL de callback que muestra el dashboard (`/auth/v1/callback`). Agregar origen de staging/producción a URL Configuration; habilitar linking manual para vincular el invitado. Probar alta Google, invitado nuevo vinculado, cuenta existente en otro navegador, cancelación y logout. No copiar el secreto Google al frontend. [Documentación Google en Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).
4. Confirmar workers de replay y liquidación (`REPLAY_WORKER_SECRET`, `APP_URL`), variables Supabase servidor y catálogos. Activar `SERVER_ECONOMY_ENABLED`, `SERVER_RANKINGS_ENABLED`, `SERVER_RANKING_PERIODS=daily,monthly` y `SERVER_OBJECT_CATALOG=extended-30` junto con sus flags públicos al inicio de un **nuevo día UTC**. Un Daily V2 ya abierto no cambia de reglas a mitad del día; el mensual de práctica empieza con esta entrega.
5. Dejar `VITE_AD_PROVIDER=none`, `SERVER_AD_REWARDS_ENABLED=false`, `VITE_PAYPAL_ENABLED=false` y `SERVER_PAYPAL_ENABLED=false`. La constante de release bloquea pagos aunque un flag cambie por error.
6. Comprobar navegador → ticket → replay worker → resultado aceptado → ledger → ranking. Repetir callbacks y operar en dos pestañas. Confirmar que una desconexión permite práctica local pero no competencia ni monedas. La renovación es UTC; un abandono no se reembolsa.
7. Activar anuncios solamente tras aprobar y probar el proveedor Google H5 y CMP real. Un `adViewed` completo concede un intento; simulación, cancelación, timeout o ausencia de anuncio no concede nada. [Ad Placement API](https://developers.google.com/ad-placement/apis?hl=en).

## Revisión económica a los 14 días de la activación

Ejecutar `supabase/reports/v3-economy.sql` en una conexión administrativa. Emisión, gastos, anuncios completados, usuarios válidos y referidos salen del servidor. Conciliar ingresos de anuncios con el reporte real del proveedor; callbacks completos **no son ingresos cobrados**. Cuando haya compras, usar capturas conciliadas menos comisiones, devoluciones e infraestructura. No convertir el volumen de monedas emitidas en dólares ingresados.

Calcular margen neto = ingresos publicitarios reales + compras netas − infraestructura. Comparar por usuario activo y por Daily válido. Revisar agotamiento de saldo, costo de ayudas, proporción de extras pagados, repetición de anuncios y concentración de premios. Modificar reglas para eventos futuros, conservando `periods.economic_rules` y las clasificaciones ya liquidadas. No se garantiza rentabilidad sin estos datos reales.
