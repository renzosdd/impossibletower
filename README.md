# Impossible Tower

**Implementación V4:** rediseño de pantallas, ayudas durante la partida, cinco misiones, insignias reclamables, Daily semanal/histórico, promociones y circuito PayPal. [Migración, configuración y validación](docs/V4-EXPERIENCE.md). Pendiente de validación aislada en staging y PayPal Sandbox; todavía sin despliegue V4 ni habilitación Live.

**Entrega V3:** jugabilidad con física compartida, Google, un panel Daily/mensual, moneda del servidor, intentos y referidos. [Contratos, pruebas y activación](docs/V3-LAUNCH.md) es la referencia de esta entrega. Las secciones V1/V2 siguientes documentan compatibilidad histórica; sus recompensas y clasificaciones anteriores no se activan en V3.


Un juego arcade de física para jugar con un dedo: soltá objetos desde una grúa y construí la torre más alta posible. La altura es la métrica principal; precisión y combos suman puntos. Los retos compartidos reproducen la misma secuencia de objetos.

Los invitados pueden practicar con nombre público y competir en el mensual. Google conserva el saldo único del servidor y permite competir en Daily. El backend online está habilitado en producción desde el 8 de octubre de 2026 UTC; Google está habilitado y falta [completar la prueba de acceso real](docs/GOOGLE-LOGIN-SETUP.md). Anuncios y cobros permanecen apagados. Las monedas no se transfieren, retiran ni convierten a dinero.

## Stack y arquitectura

TypeScript, Vite, Phaser 3, Matter.js, overlays HTML/CSS, Canvas para la tarjeta compartible, Web Audio, Vite PWA, Vitest y Playwright. No usa React. La simulación tiene un mundo lógico fijo de 420 × 746 y paso a 60 Hz: cambiar de dispositivo no cambia las dimensiones físicas. Supabase es opcional.

```text
src/
  main.ts                 Integración del juego, interfaz y servicios
  types/                  Contratos compartidos
  game/                   Escena, física e ilustraciones procedurales
  ui/                     Overlays responsive, orientación y estilos
  content/                Objetos, skins, logros y misiones
  utils/                  RNG, scoring y estabilidad puros
  services/
    storage/              Perfil versionado y progreso local
    sharing/              Challenge URL y tarjeta Canvas
    ads/                  Google H5 opcional, ledger y proveedor local
    analytics/            Interfaz y console transport
    backend/              Supabase opcional con fallbacks
public/                   Iconos y fuentes locales con licencia
tests/unit/               Lógica, migraciones y adapters
tests/e2e/                Flujos críticos del navegador
supabase/migrations/       Esquema SQL, RPCs, validación y RLS
```

## Instalación y desarrollo

Usar Node.js 22.12 o posterior y npm (Vite 7 también admite Node 20.19+).

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abrí la dirección que imprime Vite, normalmente `http://localhost:5173`. El servidor usa `--host 0.0.0.0` para probar desde un teléfono de la misma red. No hacen falta credenciales para jugar.

La configuración `.npmrc` guarda la caché de npm en `.npm-cache/` para permitir la instalación en entornos con el directorio personal protegido. Esa carpeta queda fuera de Git y del build.

| Comando | Uso |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run check` | Comprobación TypeScript |
| `npm test` | Tests unitarios |
| `npm run test:watch` | Vitest interactivo |
| `npm run test:e2e` | Flujos Playwright |
| `npm run build` | TypeScript y build de producción en `dist/` |
| `npm run preview` | Servir el build de producción |

Para E2E en una máquina propia: `npx playwright install chromium`. También se admite `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` para Chromium del sistema y `PLAYWRIGHT_BASE_URL` para un servidor existente.

## Gameplay y contenido

Tocá, clickeá el área de juego o pulsá espacio para soltar. La grúa se mueve sola. Después de caer, una pieza debe estar apoyada y casi inmóvil unos 950 ms. La partida termina al atravesar la kill zone o colapsar una parte significativa de la cima. El siguiente objeto aparece automáticamente.

La secuencia empieza con dos cajas y una mesa. Después aparecen muebles, electrodomésticos, vehículos, casa, barco, pelota y raros como cohete y satélite. El catálogo original de 18 objetos está congelado para desafíos V1; `extended-24` añade la entrega A y `extended-30` incluye las 12 incorporaciones. `VITE_OBJECT_CATALOG` selecciona la entrega Casual; Daily local conserva el catálogo original y Daily competitivo usa el catálogo fijado por el servidor para ese día. La dificultad depende del índice del drop; así dos jugadores conservan los mismos objetos aunque sus alturas sean distintas.

El score es `altura × 10 + objetos × 25 + puntos de precisión`. PERFECT y GREAT mantienen combo; GOOD y RISKY lo reinician. El multiplicador sólo afecta puntos. La altura se calcula en coordenadas del mundo, no de la cámara.

La V1 incluye Casual, Daily Tower y challenge por enlace; cámara ascendente y fases de cielo; partículas limitadas, combos, feedback, audio y vibración cuando el navegador la permite; récord, coins, 5 skins de grúa, 3 backgrounds, 5 trails, 5 efectos, 10 logros y 8 misiones. Se muestran tres misiones pendientes que rotan cada cinco partidas.

## Seeds, Daily y sharing

`createRng(seed)` usa hashing y Mulberry32. `objectAt(seed, index)` calcula cada elección independientemente: consultar objetos en otro orden no altera la secuencia. El seed diario es `tower:daily:YYYY-MM-DD:v1`, usando fecha **UTC**. Se permiten múltiples intentos, se guarda la mejor altura y se mantiene racha diaria.

Los enlaces auto contenidos llevan `{ version, seed, height, score, name? }`; V2 también incluye `catalog`. V1 conserva siempre la secuencia original de 18 objetos. Los datos se codifican en base64url dentro de `?challenge=`. Funcionan sin backend ni acortador. El decoder valida tamaños, métricas y nombres. El objetivo compartido es un reto entre amigos, no un resultado de ranking verificado.

Web Share API intenta compartir enlace y, cuando se admite, un PNG Canvas vertical de 1080 × 1920. Si no hay Web Share, se copia el link; si el portapapeles falla, se ofrece copia manual. La tarjeta sólo incluye métricas reales: no se inventan percentiles ni jugadores.

## Environment variables

Crear `.env.local` desde `.env.example`. Vite incluye estas variables en el frontend: nunca poner secretos administrativos.

| Variable | Propósito |
| --- | --- |
| `VITE_PLATFORM` | `standalone` para la distribución en Netlify |
| `VITE_AD_PROVIDER` | `none` (actual) o `google-h5` después de la aprobación |
| `VITE_GOOGLE_ADSENSE_CLIENT` | Publisher aprobado: `ca-pub-` y 16 dígitos |
| `VITE_GOOGLE_ADSENSE_CHANNEL` | Canal Google H5 opcional |
| `VITE_SUPABASE_URL` | URL pública del proyecto, opcional |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave pública preferida, opcional |
| `VITE_SUPABASE_ANON_KEY` | Clave pública legacy; fallback si publishable está vacía |
| `VITE_ANALYTICS_DEBUG` | Reservada; el console transport se activa en desarrollo |

Reiniciar Vite o reconstruir al cambiar variables. El cliente rechaza claves secretas y JWT privilegiados, pero cualquier `VITE_*` puede quedar en el frontend al compilar. Nunca introducir `service_role` ni claves administrativas.

## Orientación móvil

`src/ui/orientation.ts` intenta `screen.orientation.lock('portrait')` con un gesto, sin fullscreen. En móviles que no admiten bloqueo, landscape muestra “Girá tu dispositivo”, oculta la interfaz y pausa física, input y audio. Volver a portrait conserva torre, seed y pausa manual. La orientación física evita confundir un teclado virtual con una rotación. Desktop conserva su presentación.

Durante un anuncio se oculta el aviso de orientación, se cierran temporalmente los diálogos del juego y se mantiene bloqueado el input. Al terminar se restauran los diálogos y la pausa que corresponda.

## Publicidad opcional y recompensas

La configuración actual es `VITE_PLATFORM=standalone` y `VITE_AD_PROVIDER=none`: no carga SDKs ni muestra anuncios. La simulación publicitaria requiere `?debug=1` y elegir `Ad success` o `Ad error`.

Google H5 está preparado en `src/services/ads/googleH5.ts`. Activarlo únicamente después de obtener aprobación, publisher válido y resolver los requisitos de consentimiento aplicables. Cambiar variables requiere reconstruir. Configuración ausente o inválida conserva el proveedor local sin publicidad. Los adapters anteriores de portales se conservan por compatibilidad; la distribución prevista es exclusivamente Netlify.

El proveedor espera `onReady`. Una recompensa requiere oferta, inicio, confirmación de visualización, finalización y estado final `viewed`. Cancelación, error, falta de inventario, timeout, callbacks tardíos o solicitudes simultáneas no conceden premios. Las solicitudes se originan solo al elegir una recompensa; volver al menú no pide anuncios. Durante la solicitud se pausan física, input y audio.

| Recompensa | Condiciones y efecto |
| --- | --- |
| Segunda oportunidad | Una por partida recuperable: fallo de pieza, ≥3 objetos y resultado pendiente. Restaura la torre y revierte el resultado provisional para contabilizar una sola partida. El ranking V1 excluye partidas asistidas; el competitivo V2 admite hasta dos ayudas visibles. |
| Duplicar coins | Una por resultado con coins. Elegirla finaliza el resultado y cierra la continuación, incluso si el anuncio falla. No modifica altura ni score. También disponible al terminar una partida asistida. |
| Bono de 25 coins | En Skins; máximo tres visualizaciones completadas por día UTC y navegador/dispositivo. |
| Prueba de Confeti | En Skins si no está comprado ni hay una prueba pendiente. Próxima torre, incluida su segunda oportunidad; no desbloquea el cosmético. |

El ledger `impossible-tower.rewards.v1` se guarda separado del perfil. El bono persiste entre recargas cuando localStorage está disponible; la prueba pendiente persiste también al cambiar de día. La prueba modifica únicamente la apariencia de la escena y conserva el efecto elegido en el perfil. Storage bloqueado usa memoria durante la sesión. Estos límites son locales, sin economía autoritativa.

Contrato contrastado con documentación de Google: [adBreak](https://developers.google.com/ad-placement/apis/adbreak), [adConfig](https://developers.google.com/ad-placement/apis/adconfig) y [configuración H5](https://support.google.com/adsense/answer/9955214). Los tests simulan callbacks; no verifican inventario ni anuncios reales.

## Supabase setup

Con las dos variables vacías el juego local funciona completo. Para habilitar backend:

1. Crear un proyecto Supabase y activar Anonymous Sign-ins en Authentication.
2. Aplicar los SQL de `supabase/migrations/` en orden con CLI o SQL Editor.
3. Configurar URL y clave publishable pública (o anon legacy) y reconstruir.
4. Verificar RPCs, RLS y rankings con dos sesiones anónimas diferentes.

El esquema tiene profiles, scores, daily_scores y challenges. Las escrituras pasan por RPCs con RLS, pertenencia del usuario y límites plausibles de modo, seed, altura, puntos, objetos, precisión y duración. El Daily se verifica con fecha del servidor. Las lecturas de ranking muestran datos reales; sin backend se oculta el ranking y un backend vacío no genera jugadores ficticios.

El adapter limita la espera y aborta fetch. Los fallos no impiden jugar ni compartir enlaces auto contenidos. El respaldo de perfil V1 sigue siendo básico. La migración V2 añade un saldo e inventario autoritativos separados; no importa monedas locales ni fusiona automáticamente perfiles de dispositivos.

Un resultado normal se envía al terminar. Si existe una oferta de segunda oportunidad elegible, su envío remoto se difiere hasta elegir continuar o finalizar mediante menú, reinicio o compartir. Si se continúa, se restaura el progreso previo y se registra una sola partida final; las coins no se duplican. Las partidas asistidas se excluyen del ranking V1. Los nuevos eventos competitivos V2 aceptan ayudas autorizadas y partidas reproducidas por el servidor.

Estas validaciones **no son anti-cheat completo**. V1 confía en métricas del cliente dentro de límites básicos. V2 registra eventos por tick, emite tickets y reproduce la física compartida antes de aceptar altura, score y coins. Esto no impide bots, identidades múltiples ni búsqueda automatizada de movimientos. Los premios siguen siendo exclusivamente internos.

## Cuenta, economía y etapas V2

El saldo local anterior conserva el catálogo cosmético existente. El saldo de cuenta se acredita una sola vez con 100 coins al verificar email y usa un ledger transaccional para compras, ayudas, resultados y premios. Las operaciones online no acreditan ni gastan optimistamente cuando falta conexión.

`src/game/simulation/TowerSimulation.ts` comparte Matter, RNG, grúa, cámara, scoring y ayudas con `netlify/functions/_shared/replay.ts`. El servidor valida eventos de drop/ayuda con ticks y permisos, no métricas del navegador. Los comandos que alteran una partida en debug impiden su envío competitivo.

Las seis ayudas cuestan 25/45/20/35/50/90 coins: Guía 5, Guía 10, Vista previa de tres piezas, Foco durante tres lanzamientos, Cambio de pieza y Segunda oportunidad. Se usan hasta dos tipos por torre; las guías son excluyentes. Comprar ayudas ofrece ventaja competitiva. Los tres cosméticos online cuestan 300, 600 y 1200 coins.

Partidas, récord diario y duplicación comparten un límite de 300 coins UTC. Misiones aportan hasta 25 y bonos hasta 75; máximo ordinario 400, más rankings. Los rankings usan Daily competitivo V2, mejor altura diaria, cinco mejores días semanales y veinte mensuales. Los mínimos, desempates y premios completos están en `/reglas-ranking/`.

La cuenta usa email OTP sin cambiar la identidad anónima al vincular. Configurar las plantillas de email, SMTP y callbacks siguiendo [INTEGRATIONS.md](docs/INTEGRATIONS.md). Las declaraciones de edad y autorización del adulto no verifican documentalmente edad o tutela.

Google H5 requiere adulto, consentimiento local y una CMP real; sus callbacks no son comprobantes firmados del servidor. Las pruebas de H5 y el proveedor Mock nunca acreditan el saldo de producción. PayPal crea/captura órdenes desde Functions y procesa webhooks e idempotencia; no acreditar desde el botón o parámetros de retorno.

Activar cada entrega por separado. Variables públicas, secretos de Functions, pasos de Supabase, consentimiento, PayPal y verificaciones están en [INTEGRATIONS.md](docs/INTEGRATIONS.md). El orden y estado real se registran en [ROADMAP.md](docs/ROADMAP.md) y [VALIDATION.md](VALIDATION.md).

## Analytics architecture

`AnalyticsProvider.track(event, properties)` separa eventos del transporte. `ConsoleAnalyticsProvider` escribe sólo en desarrollo, filtra campos sensibles y no envía solicitudes a un tercero. Un proveedor real puede añadirse sin modificar física.

Se contemplan sesión, tutorial, partida, drops, aterrizajes, precisión, combos, récords, Daily, desafíos, share, rewarded, cortes, cosméticos, misiones e instalación. Las propiedades incluyen modo, seed, altura, score, objetos, duración, sesión/run y dispositivo; no hacen falta email, teléfono, documentos ni datos financieros.

## Storage y migraciones

El perfil vive bajo `impossible-tower.profile` con schema `version: 2`. Guarda récord, coins, cosméticos, preferencias, logros, misiones, Daily, racha y sesiones. `migrateProfile` recupera campos conocidos y descarta contenido inválido. JSON corrupto, cuota agotada o storage bloqueado no impide jugar; queda progreso en memoria para esa sesión.

El progreso local puede editarse desde herramientas del navegador. Los cosméticos afectan presentación y no la física ni el ranking.

## Agregar objetos y modificar dificultad

1. Añadir ID único y atributos físicos en `src/content/objects.ts`.
2. Elegir `rectangle`, `circle` o `trapezoid` y opcional `centerOfMassOffset`.
3. Dibujar el objeto propio en `src/game/objects/textures.ts`, alineado con el cuerpo físico.
4. Ajustar selección/rareza en `objectAt` y probar desde debug.

`objectAt` define etapas y rareza; `craneSpeed` define velocidad y máximo. Al cambiar una secuencia publicada, incrementar la versión del generador/seed para no alterar retos existentes silenciosamente. El seed garantiza orden de objetos. `TowerSimulation` es compartida por Phaser y el validador de Netlify; la escena solo renderiza y registra entradas. Mantener fijada la versión de Matter y versionar cualquier cambio físico posterior.

`src/utils/stability.ts` contiene thresholds, tiempo de asentamiento y colapso. Exige pérdida significativa de altura y desplazamiento de varias piezas recientes. Una pieza vieja que se mueve un poco no termina el run. Ajustar estos valores con playtesting.

## Agregar skins, misiones y logros

Los catálogos están en `src/content/cosmetics.ts`, `missions.ts` y `achievements.ts`; el progreso se evalúa en `src/services/storage/progress.ts`. Mantener IDs persistidos estables y un cosmético gratis por categoría. Efectos con geometría nueva requieren ampliar el renderer. Cambios de recompensas o targets posteriores al release necesitan migración.

## Audio

Web Audio sintetiza sonidos limpios y livianos y se desbloquea con un gesto. La música empieza apagada; música, SFX y haptics se guardan individualmente. No hay archivos de audio licenciados. Para reemplazarlos, conservar la API del audio manager y usar assets propios: drop, impactos, perfect, combo, collapse, game over, récord y botón.

Audio o vibración no disponible tiene fallback silencioso. Safari iOS normalmente no permite vibración. La interfaz respeta safe areas y permite espacio en desktop.

## PWA y verificación offline

Vite PWA genera manifest/service worker y precachea el shell con iconos propios de 192/512 px. Para verificar la versión de producción:

```bash
npm run build
npm run preview
```

Abrir una vez online en HTTPS o localhost, esperar activación del service worker y recargar offline. Deben funcionar menú, Casual, Daily y desafíos auto contenidos. Rankings y SDKs requieren red. La instalación depende del navegador y se sugiere después de engagement cuando existe prompt. En iPhone usar Compartir → Agregar a inicio.

Con preview activo, el test automatizado de producción verifica manifest, control del service worker, recarga offline y un aterrizaje físico real:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_PWA=1 npm run test:e2e -- tests/e2e/pwa.spec.ts
```

Este test se omite en el servidor de desarrollo, donde no se instala el service worker de producción.

Probar también la actualización de una instalación antigua. Limpiar caches sirve para diagnóstico, no como mecanismo de actualización del producto.

## Build y deploy

```bash
npm run check
npm test
npm run test:e2e
npm run build
```

Publicar exclusivamente `dist/` en el mismo sitio de Netlify, con HTTPS. `netlify.toml` configura build `npm run build`, salida `dist` y Node 22. HTML, manifest, service worker y archivos no versionados revalidan caché; `/assets/*` usa un año e `immutable`. `public/_headers` conserva esas reglas también en una subida manual. El juego local es estático. Cuenta, replay, premios y cobros utilizan las Netlify Functions de `netlify/functions`, desactivadas sin sus variables de servidor. La configuración asume raíz de dominio; para subdirectorios ajustar `base`, `start_url` y scope, y verificar los enlaces y service worker. No publicar `.env.local`.

El proyecto y los builds locales no implican commit, push ni publicación. `index.html` apunta al código fuente de Vite; los exports compilados históricos en la raíz se conservan, pero la entrega actual se genera en `dist/`. Consultar `VALIDATION.md` para el estado real de cada revisión.

## Testing y debug

Unitarios: RNG, secuencia/dificultad, altura, score, precisión/combo, estabilidad, migraciones, challenge, misiones/logros, ads y validación de backend. E2E: menú, partida/drop, game over físico, reinicio, Daily, challenge y preferencias persistidas. Un game over forzado en debug también permite verificar rápidamente el resultado.

`/?debug=1` habilita seed, objeto, FPS/cuerpos/centro de masa, reset de storage, coins, altura y simulación de ads. `window.__tower` permite automatización sólo en este modo; `debug('center')` fija la grúa sobre el apoyo y `debug('miss')` prepara una caída fuera de plataforma. No se graba pantalla automáticamente.

El reporte final de entrega indica qué comandos se ejecutaron y sus resultados. Chromium E2E no sustituye pruebas físicas en Safari iOS/Android ni pruebas reales de los SDKs externos.

## Limitaciones y preparación del lanzamiento

- Sensación de física, duración objetivo de 1–4 minutos y 60 FPS requieren playtesting y medición en teléfonos reales.
- Las colisiones usan formas convexas simplificadas; no toda la geometría de la ilustración.
- El seed reproduce secuencia; la física completa puede variar entre dispositivos.
- Sin backend hay progreso local y no hay ranking global ni percentil real.
- Supabase `nmdesnqgpsbtcoluyajh` está conectado al mismo sitio Netlify: cuatro migraciones, Auth anónima y permisos económicos verificados. `SUPABASE_SECRET_KEY` y `REPLAY_WORKER_SECRET` están guardadas como variables estándar autorizadas, sin marcado de secreto, disponibles en todos los alcances y contextos, incluidos previews; el código actual las lee en Functions. Economía y rankings están habilitados solo en producción, con workers publicados. Google está habilitado con redirección OAuth verificada; falta completar el acceso interactivo y verificar una partida completa; [estado y pasos](docs/GOOGLE-LOGIN-SETUP.md). No usar esas credenciales de producción para pruebas económicas en previews. Google H5 permanece apagado hasta aprobación y consentimiento.
- `/privacidad`, `/terminos` y `/reglas-ranking` contienen textos adaptados a Renzo Dogliotti y al funcionamiento implementado. Requieren revisión jurídica uruguaya antes de monetizar; no garantizan cobertura legal.
- El adapter de anuncios es una integración preparada, sin verificación de inventario real.

## Próximos cinco experimentos de producto

1. Comparar velocidades de grúa en los diez primeros drops y medir segundo intento y altura mediana.
2. Ajustar asentamiento entre 0,8 y 1,1 segundos y observar ritmo y sensación de control.
3. Comparar dos tarjetas con métricas reales y medir aperturas/aceptación de challenge.
4. Comparar Daily estable versus selección más absurda y medir retorno al día siguiente.
5. Medir segunda oportunidad elegible y su impacto en diversión y reinicio antes de integrar anuncios reales.
