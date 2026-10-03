# Supabase opcional

El juego, sus récords locales, monedas, Daily Tower y los enlaces de desafío funcionan sin Supabase. No hacen falta credenciales para desarrollar, ejecutar tests o generar el build.

## Activación

1. Creá un proyecto Supabase propio.
2. Activá **Authentication → Providers → Anonymous Sign-ins**. No se solicita email, contraseña ni información personal.
3. Ejecutá el contenido completo de [la migración](migrations/20261003021023_tower_backend.sql) en el SQL Editor del proyecto. Está preparada para un proyecto nuevo. Si utilizás el CLI, incorporala a tu flujo habitual de migrations y revisá `supabase db push --help` antes de aplicar.
4. Copiá `.env.example` a `.env.local` en la raíz del juego y completá:

   ```dotenv
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=TU-CLAVE-PUBLICABLE-O-ANON
   ```

   El nombre `ANON_KEY` también admite una clave `sb_publishable_...`. Estas variables se incluyen en el navegador: **nunca uses `service_role`, `sb_secret_...`, una contraseña de base de datos o un access token**.
5. Reiniciá Vite o regenerá el build. Verificá que `public` esté habilitado en Data API. El esquema `tower_private` debe permanecer fuera de los esquemas expuestos.
6. Completá una partida normal, consultá TODAY / ALL TIME y compartí un desafío. Una tabla vacía muestra jugadores reales solamente después de recibir resultados; no se generan rankings ficticios.

No se creó, modificó ni desplegó un proyecto remoto durante el desarrollo. Verificá Auth, Data API y los Database Advisors de tu proyecto antes de publicar.

## Modelo de acceso

| Tabla | Datos | Acceso directo del navegador |
| --- | --- | --- |
| `profiles` | Pseudónimo, perfil de progreso privado y mejor altura validada | Solo SELECT de la fila propia |
| `scores` | Resultados aceptados y duración en segundos | Solo SELECT de filas propias |
| `daily_scores` | Mejor resultado diario e intentos aceptados | Solo SELECT de filas propias |
| `challenges` | Seed, objetivo y pseudónimo del creador | Solo SELECT de desafíos propios |

Todas las tablas tienen RLS. No hay permisos INSERT, UPDATE ni DELETE para `anon` o `authenticated`: los únicos writes disponibles son los RPC `submit_run`, `sync_profile` y `create_challenge`, que extraen el propietario de `auth.uid()` y requieren autenticación.

Los wrappers públicos son `SECURITY INVOKER`. Las implementaciones `SECURITY DEFINER` viven en `tower_private`, tienen `search_path = ''`, referencias de tablas calificadas y permisos EXECUTE limitados explícitamente. `read_leaderboard` y `load_challenge` son lecturas públicas intencionales: devuelven únicamente pseudónimo y altura, o los datos del desafío compartido. No publican UUID de usuario, sesiones ni el JSON privado del perfil.

`sync_profile` guarda el progreso básico local como copia privada; V1 no restaura ni fusiona perfiles entre dispositivos. Los récords del ranking provienen exclusivamente de resultados aceptados, nunca del JSON de perfil.

## Validaciones y límites

- Modos permitidos: `casual`, `daily`, `challenge`.
- Seed: 1–96 caracteres ASCII de letras, números, `:`, `_` y `-`.
- Altura: 0–5.000 metros, también limitada a `objetos × 20 + 1`.
- Objetos: entero entre 0 y 500. Perfect drops y combo máximo no superan ese total.
- Score: entero entre 0 y 1.000.000; rango coherente con la altura, objetos y máximos de bonus de V1.
- Duración: entre `max(0,5; objetos × 0,65)` y 2.400 segundos.
- Second Chance marca la partida como asistida; el cliente y el RPC rechazan su envío al ranking. Double Coins no modifica score ni altura.
- Daily exige exactamente `tower:daily:YYYY-MM-DD:v1` para la fecha UTC actual del servidor. Una partida enviada después del cambio de día conserva su resultado local, pero no entra al ranking del día anterior.
- RPC de resultados: al menos 3 segundos entre envíos del mismo usuario y máximo 30 por minuto.
- Desafíos: máximo 8 por minuto y 100 por día por propietario. Deben corresponder al seed, altura y score de una partida previamente aceptada de ese propietario.
- Un advisory lock transaccional por usuario evita que requests simultáneos eludan los límites.
- Pseudónimos: letras, números, espacios, guion y guion bajo; máximo 24 caracteres, también sanitizados en SQL.
- Perfil JSON: versión 2, objeto de máximo 64 KiB.

Las solicitudes HTTP se abortan después de 5 segundos; los bloqueos de Auth y RPC también tienen un límite de espera. Los errores se registran en `BackendService.lastError`, las listas fallidas devuelven `[]`, y los desafíos fallidos devuelven `null` para continuar con el enlace autocontenido. Los resultados locales nunca dependen de una respuesta del backend.

## Límites de seguridad de V1

Estas reglas son validaciones básicas, **no un sistema anti-cheat perfecto**. Un cliente modificado puede inventar resultados dentro de los límites, omitir el indicador de ayuda o crear identidades anónimas adicionales. La física y duración todavía no se reproducen en el servidor. El rate limit es por identidad autenticada, no un bloqueo global por IP.

`scores.drop_events` reserva espacio para una futura secuencia limitada de eventos de cada drop. El RPC de V1 no permite escribirla. La siguiente versión puede emitir un ticket de inicio, registrar índice/objeto/x/tiempo, verificar el RNG y reproducir la simulación server-side antes de aprobar resultados.

Las cuentas anónimas dependen del almacenamiento del navegador: borrar datos o cambiar de dispositivo crea una identidad nueva. Configurá límites de Auth y evaluá CAPTCHA/Turnstile para un lanzamiento público; V1 no incluye su UI ni un proveedor de CAPTCHA.

## Verificación realizada

- 10 tests unitarios del cliente: ausencia de credenciales, anonimato, pseudónimos, resultados inválidos, partidas asistidas, fallos y timeout.
- La migración se ejecutó sobre PostgreSQL mediante PGlite en un entorno temporal. Pasaron 25 comprobaciones de RPC, validaciones, límites, aislamiento RLS por propietario, lectura pública, desafío y ranking UTC.
- PGlite utilizó roles y `auth.uid()` de prueba. No verifica el Auth HTTP de Supabase, configuración de Data API ni un proyecto alojado real.

La migración fue creada con `supabase migration new tower_backend` (CLI 2.119.0). No requiere un servicio de pago adicional.

Para repetir las comprobaciones SQL sin credenciales ni Docker, instalá la dependencia de verificación en una carpeta temporal y ejecutá el script desde la raíz del juego:

```bash
npm install --prefix /tmp/tower-db-check --no-audit --no-fund @electric-sql/pglite@0.3.14
TOWER_PGLITE_MODULE=/tmp/tower-db-check/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/backend.contract.mjs
```

El script crea una base efímera en memoria; no se conecta al proyecto Supabase ni agrega dependencias al juego.
