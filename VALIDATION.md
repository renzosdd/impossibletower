# Validación de Impossible Tower

Revisión V2 del 3 de octubre de 2026. Se distingue implementación, simulación y producción real.

## Código y pruebas locales

| Comprobación | Resultado |
|---|---|
| TypeScript y build de producción | Aprobados con Node 24.19.0; Netlify usa Node 22 |
| Tests unitarios | 281 aprobados en 17 archivos |
| PostgreSQL/PGlite | 99 comprobaciones: 25 de backend V1 y 74 de economía V2 |
| E2E existentes sobre preview de producción | 29 aprobados: 15 base, 7 recompensas, 6 orientación y 1 actualización de PWA |
| E2E nuevos de cuenta/simulación | 10 aprobados: 5 sobre Vite y 5 con Auth/API simulados |
| Entrega B | 56 regresiones focales de objetos, cuerpos, seeds, simulación y controles aprobadas |
| Revisión visual | Atlas de los 12 objetos, guía, foco/vista previa y legales móviles revisados |
| `git diff --check` | Aprobado |

Matter.js está fijado en 0.20.0. Navegador y validador usan `TowerSimulation` a 60 Hz. Tres partidas físicas con RAF solicitado a 30, 60 y 120 FPS reproducen en Node exactamente altura, score, PERFECT y secuencia observados. Se comprueban dos cajas y mesa mediante caídas reales. El replay registra ticks y acciones; el cliente no decide posiciones, score ni saldo aceptados. Estas pruebas no demuestran equivalencia en todos los motores JavaScript ni anti-cheat completo.

Las regresiones comprueban catálogos congelados de 18, 24 y 30 objetos, geometrías compuestas, masa/fricción/rebote, centros de masa y desafíos V1/V2. La mesa conserva las patas corregidas. Vista previa revela solo las tres piezas fijadas al activarla. Foco dura tres lanzamientos; continuar conserva reloj, secuencia y cuotas. Guías excluyentes y máximo de dos ayudas también se aplican a la continuación publicitaria.

Los E2E online simulan una sesión verificada y respuestas HTTP: saldo separado del perfil local, compra/consumo, pausa durante solicitudes, guía, foco, vista previa, segunda oportunidad, cambio de pieza y tabs por etapa. Comprueban que un resultado pendiente se recibe antes del siguiente ticket y que el loadout consumido no se reutiliza. No hubo una cuenta real de Supabase.

PGlite ejecuta ambas migraciones con roles de prueba y `auth.users` con RLS. La migración concede al servidor únicamente `id`, `email` y `email_confirmed_at`; el fixture comprueba que `encrypted_password` sigue inaccesible. Se verifican aislamiento, 100 coins una vez, ledger inmutable, inventario, idempotencia, topes diarios, tickets, autorización de ayudas, leases, premios y compensaciones. Las capturas/refunds de SQL y unitarios son datos simulados, no cobros PayPal. PGlite no verifica Auth HTTP, Data API alojada ni concurrencia entre conexiones independientes.

Los E2E anteriores de recompensas usan el proveedor debug. Google H5 se prueba con callbacks simulados, incluidos error, cancelación, timeout, revocación y callbacks tardíos. Test mode no acredita coins de producción. Los callbacks reales de H5 tampoco constituyen una prueba firmada del servidor.

## Publicaciones en el mismo sitio Netlify

Sitio: [impossibletower.netlify.app](https://impossibletower.netlify.app). ID: `8124dd1c-e5ba-4edc-932b-d65c63f08d29`.

| Entrega | Deploy listo | Hora UTC | Resultado real |
|---|---|---|---|
| Etapa 1: legales | `6ac1680e6be717672d5c3d5a` | 2026-10-03 20:40:18 | Tres rutas HTTP 200, identidad/contacto y diseño móvil comprobados |
| Etapa 3 A: seis objetos | `6ac16d72ce01f1f99846eef3` | 2026-10-03 21:03:29 | Ocho E2E públicos aprobados; Casual `extended-24`, desafíos V1 `legacy-18` |
| Etapa 3 B: otros seis | `6ac170f3c46095bf5638887e` | 2026-10-03 21:18:13 | Ocho E2E públicos aprobados; Casual `extended-30`, desafíos V1 `legacy-18` |

A incluye las funciones preparadas, con economía, rankings, anuncios y PayPal desactivados. Netlify registró cinco Functions con runtime Node 22; el cron `settle` está configurado cada cinco minutos UTC. Esto demuestra empaquetado y configuración, no liquidación real de premios.

Ocho escenarios públicos de A: menú sin servicios ni inspector para visitantes normales; caída física/record/reinicio; rotación conservando torre; teclado portrait mediante CDP; PWA offline con caída real; tres legales independientes; `/api/account` y `/api/paypal-webhook` devuelven 503 y `no-store` con flags apagados; catálogo nuevo y compatibilidad V1. Un selector incorrecto del fixture del último escenario fue corregido y pasó por separado, sin cambiar el juego.

La entrada de A `/assets/index-Bi-iqPjO.js` coincide con su build. B repitió los ocho E2E sin fallos y su entrada `/assets/index-CJcMk9eJ.js` coincide con el build final. Deploy inmutable: [entrega B](https://6ac170f3c46095bf5638887e--impossibletower.netlify.app). HTTP 200 y caché verificados: HTML, `sw.js` y manifest usan `public, max-age=0, must-revalidate`; assets versionados usan `public, max-age=31536000, immutable`. Los legales no cargan juego ni publicidad; Netlify puede insertar su propio script HUD.

Se publicaron snapshots sin `.env.local`, secretos, `node_modules`, cachés ni exports antiguos. El primer intento de legales (`6ac16784d3935659edfcd7b5`) falló al empaquetar un enlace de `node_modules`; eliminarlo permitió la entrega lista posterior. No se creó otro sitio ni se hizo push. Este informe se completó tras el QA público; ese registro posterior no cambia el bundle publicado.

## Activaciones y límites pendientes

- Supabase: el conector solo muestra una organización y un proyecto ajeno/inactivo. No se modificó ese proyecto ni se aplicaron migraciones externas. Falta seleccionar organización/proyecto, confirmar costo si se crea, configurar claves y SMTP, probar vinculación/recuperación, dos sesiones, Data API/RLS/RPC y replay alojado.
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

Inicio de esta revisión: `main`, limpio, commit `b1354cf`, alineado con `origin/main`. Esta sesión no creó commits ni hizo push. Los cambios quedan en el workspace; un deploy manual no actualiza el repositorio remoto.

El informe anterior describía 143 unitarios, 25 SQL y deploy `6ac14f99c15b354f1bfe3a82`; corresponde a V1. Sus datos de Git y legales provisionales no describen esta revisión V2.
