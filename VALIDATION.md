# Validación de Impossible Tower

Validado el 3 de octubre de 2026 sobre el código y build incluidos en esta entrega.

| Comprobación | Resultado |
| --- | --- |
| `npm install` | Instalación correcta |
| `npm run dev` | Menú y gameplay comprobados en navegador |
| `npm run build` | TypeScript y Vite sin errores; salida `dist/` |
| `npm test` | 143 tests aprobados en 10 archivos |
| E2E base sobre producción | 15 tests aprobados en Chrome/Chromium |
| Recompensas sobre producción | 7 E2E aprobados; callbacks publicitarios simulados |
| Orientación sobre producción | 6 E2E aprobados; 10 unitarios incluidos en el total |
| Actualización de PWA | 1 E2E aprobado entre bundle anterior y build actual |
| URL pública de Netlify | 5 E2E aprobados sobre HTTPS; entry y caché verificadas |
| PostgreSQL/PGlite | 25 comprobaciones de migración, RPC, RLS y validación aprobadas |

Verificación local con Node 24.19.0 y Google Chrome en macOS, usando el preview de producción en `http://127.0.0.1:4173`. El sandbox bloqueó inicialmente la instalación por DNS, el puerto local y el inicio de Chrome; las repeticiones con acceso autorizado completaron esas comprobaciones.

El build genera service worker y manifest con 22 entradas de precache. Los E2E prueban recarga offline y un aterrizaje físico real sin red, además de menú, caída, kill zone, reinicio, récord, Daily UTC, desafío con el mismo seed, copia/manual fallback, pausa, preferencias, anuncio fallido y segunda oportunidad sin duplicar coins. La tarjeta compartible fue generada por Canvas y decodificada como PNG real de 1080 × 1920 con URL y métricas correctas.

## Orientación, recompensas y actualización

Se restauró `index.html` como entrada del código fuente Vite: la copia recibida apuntaba a assets compilados, mientras los fuentes carecían de parte de las mejoras descritas. Se incorporaron netlify.toml, .env.example y reglas de caché para builds y subidas manuales.

Los 29 escenarios locales de navegador pasaron: 15 base, 7 recompensas, 6 orientación y 1 actualización de PWA. No se registraron errores JavaScript.

Orientación comprueba rotación móvil, conservación de torre/seed/score, pausa manual, teclado virtual con orientación física portrait, desktop y aviso oculto durante anuncio simulado. Las métricas del teclado usan CDP; reducir el viewport con Playwright por sí solo también altera orientación y no representa un teclado.

Recompensas comprueba bono de 25 coins, tres usos por día UTC, recarga/cambio de día, Confeti pendiente/comprado, tres drops físicos más una caída fallada, segunda oportunidad asistida, restauración del efecto y duplicación final. Duplicar cierra la continuación tanto con éxito como con fallo del anuncio. Fallos no otorgan premios y volver al menú no inicia anuncios. Durante dos anuncios simulados de Skins se verificó que ningún diálogo nativo quedara abierto y que el diálogo volviera al terminar.

La actualización de PWA usa un servidor local que pasa del bundle compilado anterior al build actual en el mismo origen. Verifica cambio de service worker y entrada versionada, conservación de perfil y ledger, recarga offline y aterrizaje físico. Conserva el contrato persistido `version/day/coinClaims/pendingTrial`: dos bonos usados y Confeti pendiente sobreviven a la actualización. Es una simulación real de actualización en Chrome, no una prueba de instalación en un teléfono físico.

## Ajuste de física verificado previamente

El playtest detectó que las patas de la mesa inicial podían quedar muy cerca del borde de la caja inferior y provocar una inclinación prematura. Se movieron hacia adentro, se alineó la ilustración con el cuerpo y se agregó una regresión que simula dos cajas dinámicas, mesa y cuarta caja con el mismo motor y criterio de estabilidad del juego.

El reporte original también verificó el apilado real en navegador con dos seeds, sin colocar cuerpos artificialmente. La grúa se alineó automáticamente y cada objeto cayó y se estabilizó mediante Matter.js:

| Seed | Objetos | Altura | Perfect Drops | Final |
| --- | --- | --- | --- | --- |
| `physics-balanced` | 8 | 50.6 m | 7 | Colapso natural al añadir el noveno objeto |
| `tower:daily:2026-10-03:v1` | 8 | 49.2 m | 8 | Colapso natural al añadir el noveno objeto |

Ambos completaron los cuatro primeros objetos con cuatro Perfect Drops, según la entrega original. En esta revisión se repitió la regresión de cuatro objetos físicos y la recuperación de tres objetos; no se repitieron las dos sesiones completas de ocho objetos.

## Repetir la validación

```bash
npm install
npm test
npm run build
npm run preview
```

Con preview activo, en otra terminal:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_PWA=1 npm run test:e2e
```

La configuración usa Chromium del sistema si existe `/usr/bin/chromium` o Google Chrome de macOS si está instalado. En otra máquina puede instalarse con `npx playwright install chromium` o configurarse `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Las instrucciones para repetir las comprobaciones SQL están en `supabase/README.md`.

## Alcance y límites

Chromium headless y PostgreSQL/PGlite no sustituyen pruebas en teléfonos físicos, Safari, Auth alojado de Supabase ni inventario real de portales. El objetivo de 60 FPS y las sesiones de 1–4 minutos requieren medición y playtesting en dispositivos reales. Los conectores identificaron `impossibletower.netlify.app` como el sitio del mismo repositorio y commit inicial. Esta revisión fue publicada en producción mediante el conector Netlify, deploy `6ac14f99c15b354f1bfe3a82`, listo el 3 de octubre de 2026 a las 15:55 (America/Montevideo). Supabase muestra solo un proyecto ajeno/inactivo: no se aplicó ninguna migración externa ni se verificaron Auth/Data API alojados. Los límites del backend son validaciones básicas, no anti-cheat completo. Privacy y Terms son borradores que deben completarse antes del lanzamiento comercial.

## Git y configuración de entrega

Estado inicial: `main`, limpio, commit `107d2d4`, remoto `https://github.com/renzosdd/impossibletower.git`. Durante el trabajo apareció el commit local `1f4ee83`; no se ejecutaron commit ni push desde esta sesión. El estado observado queda un commit por delante de origin/main, más los cambios posteriores de validación.

Publicidad: `VITE_PLATFORM=standalone`, `VITE_AD_PROVIDER=none`. No se verificó publicidad real. Supabase no tiene variables configuradas en el sitio. Privacidad y Términos siguen provisionales; faltan datos del responsable/contacto, revisión legal y consentimiento antes de activar publicidad. Safari/iOS/Android físicos, rendimiento de 60 FPS y actualización de instalación física siguen pendientes.

## Producción verificada

URL: https://impossibletower.netlify.app

Deploy inmutable: https://6ac14f99c15b354f1bfe3a82--impossibletower.netlify.app

Netlify reconstruyó una copia de los fuentes verificados, sin credenciales, node_modules, cachés ni exports antiguos. El primer intento devolvió 401; renovar la autorización temporal del conector permitió publicar. No se creó otro sitio ni se hizo push de Git. La vinculación local del sitio queda en .netlify/state.json, fuera de Git.

Cinco E2E en la URL pública aprobaron menú sin servicios/debug para visitantes normales, caída real/record/reinicio, rotación con torre conservada, teclado virtual portrait y PWA offline con aterrizaje real. La entrada pública `/assets/index-BQ1Yk7ky.js` coincide con el build local. HTTP 200 y Cache-Control comprobados: HTML, sw.js y manifest revalidan; el asset versionado usa max-age=31536000, immutable. Netlify informa cuatro reglas de headers procesadas.

La publicidad real y Supabase alojado siguen sin activar ni verificar; todas las pruebas de recompensas utilizan el proveedor simulado de debug. El informe local y los últimos ajustes del fixture de orientación se guardaron después de subir los fuentes; no cambian el bundle publicado.
