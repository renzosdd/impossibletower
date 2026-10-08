# Activar Google en Impossible Tower

## Estado al 7 de octubre de 2026 · Montevideo

El backend de producción está publicado en https://impossibletower.netlify.app. Supabase tiene las cuatro migraciones, incluida V3. Economía y rankings Daily/mensual están habilitados en producción. Google ya está habilitado con el cliente OAuth proporcionado por el titular. Se verificó la redirección a Google con el cliente y callback correctos; falta completar un acceso interactivo y una Daily real. Anuncios y PayPal permanecen apagados.

Los pasos 1–3 quedan como referencia: las credenciales ya se cargaron en Supabase. Para probar el acceso, continuá en la sección 4.

## 1. Crear el proyecto y configurar Google

Abrí [Google Auth Platform](https://console.cloud.google.com/auth/overview), seleccioná o creá un proyecto llamado **Impossible Tower** y completá **Comenzar / Get started**:

- Nombre de aplicación: **Impossible Tower**.
- Correo de asistencia y contacto: tu correo de Google.
- Público / Audience: **Externo / External**, para permitir cuentas fuera de tu organización.
- En **Acceso a los datos / Data Access**, usá solamente `openid`, `https://www.googleapis.com/auth/userinfo.email` y `https://www.googleapis.com/auth/userinfo.profile`.

Si completás las URLs de marca, el sitio es `https://impossibletower.netlify.app`, la privacidad está en `https://impossibletower.netlify.app/privacidad/` y los términos en `https://impossibletower.netlify.app/terminos/`. Si Google solicita verificación de marca, seguí los requisitos que muestre la consola; guardar el cliente no equivale a completar esa verificación.

## 2. Obtener las credenciales

Entrá en **Clientes / Clients → Crear cliente / Create client**:

| Campo | Valor |
|---|---|
| Tipo de aplicación | Aplicación web / Web application |
| Nombre | Impossible Tower Web |
| Orígenes autorizados de JavaScript | `https://impossibletower.netlify.app` |
| URI de redireccionamiento autorizados | `https://nmdesnqgpsbtcoluyajh.supabase.co/auth/v1/callback` |

Presioná **Crear**. Guardá el **Client ID** y el **Client Secret**, o descargá el JSON en ese momento: Google solo muestra el secreto completo al crearlo. Conservá ese archivo de forma privada.

El callback de Google es la URL de Supabase de la tabla, no la página del juego. [Instrucciones oficiales de Google](https://support.google.com/cloud/answer/15549257?hl=en).

## 3. Dónde cargarlas

Abrí [Supabase → Authentication → Sign In / Providers](https://supabase.com/dashboard/project/nmdesnqgpsbtcoluyajh/auth/providers) y seleccioná **Google**:

1. Activá **Enable Sign in with Google**.
2. Pegá el **Client ID** en **Client IDs**.
3. Pegá el **Client Secret** en **Client Secret**.
4. Mantené **Skip nonce checks** desactivado.
5. Guardá los cambios.

No se sube el JSON al juego: se copian sus dos valores en Supabase. No los agregues a Git, Netlify ni al chat. La integración ya está publicada; guardar el proveedor no requiere otro despliegue. [Configuración oficial de Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

En [Supabase → URL Configuration](https://supabase.com/dashboard/project/nmdesnqgpsbtcoluyajh/auth/url-configuration), el **Site URL** debe seguir siendo `https://impossibletower.netlify.app`. Conservá la vinculación manual de identidades habilitada para convertir un invitado en cuenta Google.

## 4. Probar y abrir al público

En Google Auth Platform → **Audience**, podés agregar tu cuenta como usuario de prueba mientras terminás la configuración. Para abrir el acceso público, usá **Publish app / Publicar aplicación** y revisá el estado que indique Google.

Desde un navegador normal, abrí [Impossible Tower](https://impossibletower.netlify.app), pulsá **Daily Tower → Continuar con Google** y completá el acceso. Comprobá:

- Regreso al juego, nombre público y sesión conservada al recargar.
- Cuenta nueva: 60 monedas de bienvenida una sola vez y tres intentos gratuitos del día.
- Una partida Daily válida llega al ranking después de la validación del replay.
- Cerrar sesión e ingresar en otro navegador recupera la misma cuenta y saldo.
- Vincular un invitado nuevo conserva su progreso; recuperar una cuenta existente carga esa cuenta sin sumar saldos.

Estas comprobaciones reales siguen pendientes de completar un acceso interactivo con Google. No confundir la disponibilidad del backend con una partida competitiva validada de extremo a extremo.

## Si aparece un error

| Error | Revisar |
|---|---|
| Provider is not enabled / Unsupported provider | Google habilitado y guardado en Supabase. |
| redirect_uri_mismatch | Callback idéntico al de la tabla, incluido `/auth/v1/callback`. |
| Access blocked / access_denied | Estado de Audience, usuario de prueba y requisitos que indique Google. |
| Regresa a otro sitio | Site URL y redirects de Supabase. |

## Verificación del backend realizada

- Publicación Git CI: commit `dfddb75694b9ddcb7e49c436afbf13f19e83696f`, deploy `6ac6df4ee735903cb885ec40`, publicado el **2026-10-08 a las 00:10:17 UTC**.
- Flags de economía y rankings habilitados para contexto **production**; períodos `daily,monthly`. No se habilitaron previews.
- Sitio y bundle publicados responden; bundle apunta al proyecto Supabase correcto.
- Clave del servidor comprobada con consulta de lectura; endpoint de cuenta activo y exige autenticación.
- Auth anónima y Google habilitados. El endpoint público de Auth confirma `external.google=true`; `/auth/v1/authorize` responde HTTP 302 hacia `accounts.google.com` con el Client ID suministrado y el callback de este proyecto.
- Supabase confirmó el guardado del Client ID y Client Secret. Se mantuvo la comprobación de nonce y el requisito de email. Site URL, redirects y vinculación manual permanecieron sin cambios. El secreto no se escribió en el repositorio ni en los registros de verificación.
- Esta prueba no completa el intercambio de código por sesión ni verifica la audiencia pública configurada en Google Cloud.
- Tablas económicas con RLS y RPC económica reservada a `service_role`.
- Functions publicadas: `account`, `replay-background`, `settle-background` y `settle`, esta última programada cada cinco minutos. Su registro no demuestra todavía un cierre Daily real. El HTTP 202 de un worker solo confirma la recepción asíncrona.
- PayPal responde como deshabilitado; proveedor publicitario desactivado.
- No se crearon usuarios ficticios ni se acreditaron monedas de prueba en producción. Siguen pendientes OAuth real, una partida completa, liquidación real y concurrencia entre conexiones de staging.
