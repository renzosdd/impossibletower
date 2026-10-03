# Validación de V1

Validado el 3 de octubre de 2026 sobre el código y build incluidos en esta entrega.

| Comprobación | Resultado |
| --- | --- |
| `npm install` | Instalación correcta |
| `npm run dev` | Menú y gameplay comprobados en navegador |
| `npm run build` | TypeScript y Vite sin errores; salida `dist/` |
| `npm test` | 81 tests aprobados en 7 archivos |
| E2E sobre producción | 15 tests aprobados en Chromium |
| PostgreSQL/PGlite | 25 comprobaciones de migración, RPC, RLS y validación aprobadas |

El build genera service worker y manifest con 22 entradas de precache. Los E2E prueban recarga offline y un aterrizaje físico real sin red, además de menú, caída, kill zone, reinicio, récord, Daily UTC, desafío con el mismo seed, copia/manual fallback, pausa, preferencias, anuncio fallido y segunda oportunidad sin duplicar coins. La tarjeta compartible fue generada por Canvas y decodificada como PNG real de 1080 × 1920 con URL y métricas correctas.

## Ajuste de física verificado

El playtest detectó que las patas de la mesa inicial podían quedar muy cerca del borde de la caja inferior y provocar una inclinación prematura. Se movieron hacia adentro, se alineó la ilustración con el cuerpo y se agregó una regresión que simula dos cajas dinámicas, mesa y cuarta caja con el mismo motor y criterio de estabilidad del juego.

También se verificó el apilado real en navegador con dos seeds, sin colocar cuerpos artificialmente. La grúa se alineó automáticamente y cada objeto cayó y se estabilizó mediante Matter.js:

| Seed | Objetos | Altura | Perfect Drops | Final |
| --- | --- | --- | --- | --- |
| `physics-balanced` | 8 | 50.6 m | 7 | Colapso natural al añadir el noveno objeto |
| `tower:daily:2026-10-03:v1` | 8 | 49.2 m | 8 | Colapso natural al añadir el noveno objeto |

Ambos completaron los cuatro primeros objetos con cuatro Perfect Drops. No se registraron errores de página.

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

La configuración usa Chromium del sistema si existe `/usr/bin/chromium`. En otra máquina puede instalarse con `npx playwright install chromium` o configurarse `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Las instrucciones para repetir las comprobaciones SQL están en `supabase/README.md`.

## Alcance y límites

Chromium headless y PostgreSQL/PGlite no sustituyen pruebas en teléfonos físicos, Safari, Auth alojado de Supabase ni inventario real de portales. El objetivo de 60 FPS y las sesiones de 1–4 minutos requieren medición y playtesting en dispositivos reales. No se usaron credenciales externas ni se publicó el proyecto. Los límites del backend son validaciones básicas, no anti-cheat completo. Privacy y Terms son borradores que deben completarse antes del lanzamiento comercial.
