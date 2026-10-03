# Validación de Impossible Tower

Revisión V2 del 3 de octubre de 2026. Se distingue implementación, simulación y producción real.

## Código y pruebas locales

| Comprobación | Resultado |
|---|---|
| TypeScript y build de producción | Aprobados con Node 24.19.0; Netlify usa Node 22 |
| Tests unitarios | 281 aprobados en 17 archivos |
| PostgreSQL/PGlite | 100 comprobaciones: 25 de backend V1 y 75 de economía V2 |
| E2E existentes sobre preview de producción | 29 aprobados: 15 base, 7 recompensas, 6 orientación y 1 actualización de PWA |
| E2E nuevos de cuenta/simulación | 10 aprobados: 5 sobre Vite y 5 con Auth/API simulados |
| Entrega B | 56 regresiones focales de objetos, cuerpos, seeds, simulación y controles aprobadas |
| Revisión visual | Atlas de los 12 objetos, guía, foco/vista previa y legales móviles revisados |
| `git diff --check` | Aprobado |

Matter.js está fijado en 0.20.0. Navegador y validador usan `TowerSimulation` a 60 Hz. Tres partidas físicas con RAF solicitado a 30, 60 y 120 FPS reproducen en Node exactamente altura, score, PERFECT y secuencia observados. Se comprueban dos cajas y mesa mediante caídas reales. El replay registra ticks y acciones; el cliente no decide posiciones, score ni saldo aceptados. Estas pruebas no demuestran equivalencia en todos los motores JavaScript ni anti-cheat completo.

Las regresiones comprueban catálogos congelados de 18, 24 y 30 objetos, geometrías compuestas, masa/fricción/rebote, centros de masa y desafíos V1/V2. La mesa conserva las patas corregidas. Vista previa revela solo las tres piezas fijadas al activarla. Foco dura tres lanzamientos; continuar conserva reloj, secuencia y cuotas. Guías excluyentes y máximo de dos ayudas también se aplican a la continuación publicitaria.

Los E2E online simulan una sesión verificada y respuestas HTTP: saldo separado del perfil local, compra/consumo, pausa durante solicitudes, guía, foco, vista previa, segunda oportunidad, cambio de pieza y tabs por etapa. Comprueban que un resultado pendiente se recibe antes del siguiente ticket y que el loadout consumido no se reutiliza. En esos E2E no hubo una cuenta real de Supabase; las pruebas HTTP posteriores se describen abajo.

PGlite ejecuta ambas migraciones con roles de prueba y `auth.users` con RLS. La migración concede al servidor únicamente `id`, `email` y `email_confirmed_at`; el fixture comprueba que `encrypted_password` sigue inaccesible. Se verifican aislamiento, 100 coins una vez, ledger inmutable, inventario, idempotencia, topes diarios, tickets, autorización de ayudas, leases, premios y compensaciones. Las capturas/refunds de SQL y unitarios son datos simulados, no cobros PayPal. PGlite no verifica Auth HTTP, Data API alojada ni concurrencia entre conexiones independientes.

Los E2E anteriores de recompensas usan el proveedor debug. Google H5 se prueba con callbacks simulados, incluidos error, cancelación, timeout, revocación y callbacks tardíos. Test mode no acredita coins de producción. Los callbacks reales de H5 tampoco constituyen una prueba firmada del servidor.

## Publicaciones en el mismo sitio Netlify

Sitio: [impossibletower.netlify.app](https://impossibletower.netlify.app). ID: `8124dd1c-e5ba-4edc-932b-d65c63f08d29`.

| Entrega | Deploy listo | Hora UTC | Resultado real |
|---|---|---|---|
| Etapa 1: legales | `6ac1680e6be717672d5c3d5a` | 2026-10-03 20:40:18 | Tres rutas HTTP 200, identidad/contacto y diseño móvil comprobados |
| Etapa 3 A: seis objetos | `6ac16d72ce01f1f99846eef3` | 2026-10-03 21:03:29 | Ocho E2E públicos aprobados; Casual `extended-24`, desafíos V1 `legacy-18` |
| Etapa 3 B: otros seis | `6ac170f3c46095bf5638887e` | 2026-10-03 21:18:13 | Ocho E2E públicos aprobados; Casual `extended-30`, desafíos V1 `legacy-18` |
| Conexión Supabase | `6ac185c453392d3d0834103e` | 2026-10-03 22:47:11 | Ocho E2E públicos más un flujo real de Auth/caída del servicio aprobados |
| Claves privadas de servidor | `6ac19110c15b35c484fe3acf` | 2026-10-03 23:34:52 | Variables estándar autorizadas, bundle sin claves privadas y servicios apagados verificados |

A incluye las funciones preparadas, con economía, rankings, anuncios y PayPal desactivados. Netlify registró cinco Functions con runtime Node 22; el cron `settle` está configurado cada cinco minutos UTC. Esto demuestra empaquetado y configuración, no liquidación real de premios.

Ocho escenarios públicos de A: menú sin servicios ni inspector para visitantes normales; caída física/record/reinicio; rotación conservando torre; teclado portrait mediante CDP; PWA offline con caída real; tres legales independientes; `/api/account` y `/api/paypal-webhook` devuelven 503 y `no-store` con flags apagados; catálogo nuevo y compatibilidad V1. Un selector incorrecto del fixture del último escenario fue corregido y pasó por separado, sin cambiar el juego.

La entrada de A `/assets/index-Bi-iqPjO.js` coincide con su build. B repitió los ocho E2E sin fallos y su entrada `/assets/index-CJcMk9eJ.js` coincide con el build final. Deploy inmutable: [entrega B](https://6ac170f3c46095bf5638887e--impossibletower.netlify.app). HTTP 200 y caché verificados: HTML, `sw.js` y manifest usan `public, max-age=0, must-revalidate`; assets versionados usan `public, max-age=31536000, immutable`. Los legales no cargan juego ni publicidad; Netlify puede insertar su propio script HUD.

Se publicaron snapshots sin `.env.local`, secretos, `node_modules`, cachés ni exports antiguos. El primer intento de legales (`6ac16784d3935659edfcd7b5`) falló al empaquetar un enlace de `node_modules`; eliminarlo permitió la entrega lista posterior. No se creó otro sitio ni se hizo push. Este informe se completó tras el QA público; ese registro posterior no cambia el bundle publicado.

## Activaciones y límites pendientes

- Supabase: proyecto `nmdesnqgpsbtcoluyajh` configurado; tres migraciones aplicadas, Auth anónimo y vinculación manual activos, URL de Netlify configurada y esquemas privados fuera de Data API. Pasaron pruebas SQL alojadas y 23 comprobaciones HTTP con dos sesiones anónimas reales. Faltan SMTP, plantillas OTP, vinculación/recuperación por email real, replay y economía alojados.
- Economía y premios: el código y las pruebas no demuestran ejecución real del scheduler, concurrencia alojada ni recuperación ante fallos externos. Activar diario primero; semanal y mensual después, con flags independientes.
- Google: faltan aprobación H5, publisher, línea exacta de `ads.txt`, SDK real de CMP certificada y anuncios reales. No se inventaron esos datos. Edad/tutela son declaraciones; menores y edad desconocida no cargan publicidad.
- PayPal: faltan Business Uruguay, aprobación específica para coins, credenciales y pruebas sandbox. Compra, devolución y retiro reales siguen pendientes. No hubo cobros.
- Dispositivos: no se probaron teléfonos físicos Safari/iOS/Android, 60 FPS sostenidos ni actualización de una PWA instalada físicamente. La actualización local de un bundle anterior al actual en Chrome conserva perfil/ledger y juego offline.
- Legales: responsable/contacto completados y funcionamiento actual/futuro diferenciados. Son una base, no garantía de cobertura; revisión uruguaya antes de monetizar.

El juego local continúa cuando falla un servicio. Gastos y créditos nuevos del wallet online requieren conexión y confirmación del servidor; las coins históricas siguen separadas para el catálogo local.

## Repetir comprobaciones

Usar Node 22.12 o posterior.

```bash
npm install
npm test
npm run build
npm run preview
```

Con preview activo:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_PWA=1 npm run test:e2e -- tests/e2e/game.spec.ts tests/e2e/sharing.spec.ts tests/e2e/pwa.spec.ts tests/e2e/orientation.spec.ts tests/e2e/rewards.spec.ts tests/e2e/pwa-update.spec.ts
```

Los cinco escenarios nuevos de simulación usan Vite dev con `?inspect=1`; ese inspector no existe en producción. Ejecutar `tests/e2e/account-and-simulation.spec.ts` sobre dicho servidor. Para sus cinco escenarios de cuenta, iniciar otro Vite con variables ficticias:

```bash
VITE_SUPABASE_URL=https://tower-test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test VITE_SERVER_ECONOMY_ENABLED=true VITE_SERVER_RANKINGS_ENABLED=true VITE_RANKING_PERIODS=daily,weekly,monthly npm run dev -- --port 5181 --strictPort
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5181 PLAYWRIGHT_ACCOUNT_ENABLED=1 npm run test:e2e -- tests/e2e/account-and-simulation.spec.ts
```

Verificación pública focal:

```bash
PLAYWRIGHT_BASE_URL=https://impossibletower.netlify.app PLAYWRIGHT_PWA=1 PLAYWRIGHT_RELEASE_VERIFY=1 PLAYWRIGHT_RELEASE_CATALOG=extended-30 npm run test:e2e -- tests/e2e/game.spec.ts tests/e2e/orientation.spec.ts tests/e2e/pwa.spec.ts tests/e2e/release.spec.ts --grep 'loads menu|places a real box|rotation freezes|portrait keyboard|production manifest|legal pages|published'
```

La configuración usa Chrome de macOS o Chromium del sistema. Puede configurarse `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. SQL y activación real: [Supabase](supabase/README.md), [integraciones](docs/INTEGRATIONS.md), [etapas](docs/ROADMAP.md).

## Git

La revisión V2 comenzó en `b1354cf`. Al iniciar la configuración alojada del 3 de octubre, `main` estaba limpio en `ee43cfc`, alineado con `origin/main`: el usuario había actualizado Git. Esta configuración no creó commits ni hizo push. Los nuevos cambios quedan en el workspace; el deploy manual no actualiza Git.

El informe anterior describía 143 unitarios, 25 SQL y deploy `6ac14f99c15b354f1bfe3a82`; corresponde a V1. Sus datos de Git y legales provisionales no describen esta revisión V2.

## Configuración alojada de Supabase

Proyecto autorizado: `nmdesnqgpsbtcoluyajh`, región `us-west-2`, PostgreSQL 17.11.0.002. Tres migraciones aplicadas; se añadió una migración de índices para las dos claves foráneas faltantes. El historial se alineó con las versiones locales usando guards de nombres y SQL, sin volver a ejecutar las migraciones. `migration list` coincide y `db push --dry-run --skip-vault` no tiene pendientes.

Quince tablas con RLS. Antes de activar Auth anónima, advisors sin WARN ni ERROR. Después, aparecen cuatro WARN por lectura del propio perfil/resultado/desafío V1 para usuarios anónimos autenticados: son accesos requeridos por V1 y el aislamiento entre propietarios pasó por HTTP. No se ampliaron permisos económicos; las tablas V2 siguen privadas. Los INFO de tablas privadas sin políticas son deliberados. Siete grupos SQL alojados aprobaron aislamiento, grants, RPCs V1, wallet/ledger, tickets, resultado confiable simulado e idempotencia contable. Se ejecutaron con BEGIN/ROLLBACK: no prueban envío de emails, replay físico alojado ni pagos reales.

Auth HTTP: 23 comprobaciones aprobadas con dos usuarios anónimos reales. Verifican perfiles propios y aislamiento, rechazo de RPC económica para clientes, lectura de rankings, desafío compartido, acceso público permitido y esquemas privados no expuestos. Un resultado V1 de altura/score cero fue un fixture HTTP para comprobar la cadena de desafío, no una partida física verificada. La clave privada accedió al snapshot de invitado con saldo cero y el servidor rechazó su ticket económico sin email confirmado. Las sesiones fueron cerradas y sus cuentas/perfiles/resultados/desafíos de prueba eliminados. No se enviaron emails ni se hicieron cobros.

Auth anónimo y manual linking activos; Site URL apunta al mismo sitio Netlify, confirmación de email obligatoria. La CLI confirmó cero diferencias declaradas pendientes y preservó nueve ajustes no declarados. El proyecto Free rechazó plantillas personalizadas con su proveedor predeterminado: se conservan hasta configurar SMTP. El titular confirmó que todavía no tiene SMTP. Cuenta/economía, rankings con premios, anuncios y PayPal siguen desactivados. URL y clave pública guardadas en Netlify con todos los alcances/contextos admitidos por el plan. Después del rechazo de alcances específicos, el titular autorizó guardar `SUPABASE_SECRET_KEY` y `REPLAY_WORKER_SECRET` como variables estándar, sin marcado de secreto, en todos los alcances y contextos. El readback oficial confirmó 24 variables y ambos valores exactos sin mostrarlos. Guardarlas no habilita economía ni verifica SMTP/OTP o replay alojado. Las claves no tienen prefijo VITE y no se copiaron al repositorio.

El primer deploy de configuración `6ac1838a82e995a7ac077f2a` quedó listo a las 22:37:41 UTC, con las ocho regresiones públicas aprobadas, pero conservó el bundle anterior: el conector informó éxito al crear variables granulares que no persistieron. El probe de Auth del navegador detectó la configuración ausente. Se corrigieron las variables públicas usando alcances/contextos compatibles; se verificaron las 22 variables públicas/flags guardados, coincidencia de la clave publishable y ausencia de secretos antes de reconstruir.

Deploy final: [Supabase conectado](https://6ac185c453392d3d0834103e--impossibletower.netlify.app). Entrada `/assets/index--1KXFWsE.js` idéntica al build local, con URL y clave publishable correctas; todas las piezas JavaScript publicadas se comprobaron sin los secretos reales de Supabase. HTTP/caché y cinco Functions con schedule `settle` cada cinco minutos confirmados. Economía y pagos continúan respondiendo 503 con `no-store`, sin inicializar servicios.

Las ocho regresiones públicas volvieron a pasar sobre el build final. Un flujo adicional de navegador confirmó que no hay registro Auth con edad desconocida, que seleccionar adulto crea una sesión anónima real, que la cuenta recuperable continúa apagada y que, tras bloquear Supabase y recargar, se coloca una caja física sin SDK publicitario ni errores JavaScript. La sesión de prueba se cerró y eliminó. Se confirmó cero usuarios anónimos, perfiles, scores, desafíos, wallets y ledger al terminar. No se verificó OTP, entrega de coins/prizes, scheduler económico, anuncios reales ni PayPal.

Esta continuación volvió a aprobar 281 unitarios, 100 checks SQL, TypeScript/build y `git diff --check`. No creó commits ni push. El registro final se completó después de verificar producción; no modifica el bundle publicado.

## Seguimiento del guardado de secretos

El conector informó éxito en varios intentos de guardar `SUPABASE_SECRET_KEY` y `REPLAY_WORKER_SECRET` marcadas secretas, pero ninguna persistió: la lectura posterior conservó las 22 variables previas. Hubo rechazos iniciales de revisión automática por acceso durante compilación y un intento limitado a Functions que tampoco persistió. El titular confirmó después production, Builds y Functions explícitamente; la revisión permitió esos upserts. La autorización está resuelta.

Tras el login oficial autorizado, se confirmó el sitio correcto y el plan `nf_team_dev`. `netlify env:set` terminó con exit 0 y sin salida, pero el CLI ocultó el rechazo al lanzar `json.msg`, ausente en la respuesta. El SDK oficial `createEnvVars` devolvió HTTP 403 con `{code:403,message:'Upgrade your Netlify account to set specific scopes'}`. La lectura oficial volvió a confirmar 22 variables y ninguna de las dos claves privadas. Ese rechazo confirmó la restricción del plan para alcances específicos; no demuestra que `is_secret` por sí solo requiera Pro.

El titular autorizó después explícitamente mantener Free y utilizar variables estándar, sin marcado de secreto, en todos los alcances y contextos. El guardado y readback oficial aprobaron 24 variables: ambas claves privadas con `is_secret:false`, scopes `builds`, `functions`, `post_processing` y `runtime`, contexto `all`. Sus valores exactos se confirmaron sin mostrarlos. Esto resolvió el guardado sin cambiar el plan; no se modificaron flags.

Una revisión independiente confirmó que el código actual lee las claves en `netlify/functions`, sin imports desde `src`, ampliación de envPrefix o inyección de process.env en Vite. Su disponibilidad en Netlify es más amplia: incluye builds y previews. No usar esas credenciales de producción para pruebas económicas en previews. El guardado no demuestra uso runtime ni activación de servicios. Cuenta, economía, rankings con premios, anuncios y PayPal continúan apagados.

La CLI publicó [la configuración de servidor](https://6ac19110c15b35c484fe3acf--impossibletower.netlify.app) en el mismo sitio: estado `ready`, contexto `production`, publicación 2026-10-03 23:34:52 UTC. Reutilizó el build previamente validado y reempaquetó las Functions; el primer comando fue rechazado antes de subir archivos porque `--context` requiere build, y se corrigió conservando `--prod`. Se confirmaron cinco Functions y el cron `settle` cada cinco minutos. Esto verifica configuración y empaquetado, no uso real de las claves ni liquidación de premios.

Los 26 archivos de `dist` se escanearon antes de subirlos: sin claves privadas de Supabase, clave del worker, archivos `.env` ni enlaces simbólicos. Todos los JavaScript publicados volvieron a comprobarse contra los valores privados reales. La entrada `/assets/index--1KXFWsE.js` coincide con el build local y contiene exclusivamente la URL y clave pública esperadas. HTTP y caché de HTML, service worker, manifest y assets aprobados. Los tres legales siguen independientes y sin anuncios. `/api/account` y `/api/paypal-webhook` siguen respondiendo 503 con `no-store`; no se activaron servicios ni se hicieron cobros. No hubo commit ni push.
