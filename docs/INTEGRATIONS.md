> Estado V3 al 8 de octubre de 2026: backend publicado y economía/rankings Daily y mensual habilitados en producción. Google habilitado y redirección OAuth verificada; [estado y pasos para probar el acceso](GOOGLE-LOGIN-SETUP.md). Para operación actual, usar [V3-LAUNCH.md](V3-LAUNCH.md). Las secciones 1 y 2 siguientes conservan la configuración histórica V2 (OTP, flags apagados, semanas y recompensas anteriores); no son instrucciones de activación V3. SMTP no es requisito del acceso Google actual.

# Activación de integraciones

Distribución: el mismo sitio de Netlify. Los tests locales no demuestran aprobación de Google, pagos reales, entrega de emails ni ejecución del scheduler en producción. Registrar esos resultados por separado en `VALIDATION.md`.

## 1. Supabase y cuenta recuperable

Estado configurado: proyecto `nmdesnqgpsbtcoluyajh`, Auth anónima y vinculación manual activas, Site URL `https://impossibletower.netlify.app`, tres migraciones y 23 comprobaciones HTTP reales aprobadas. URL y clave pública se guardaron en Netlify con todos los contextos y alcances y quedaron incorporadas al deploy `6ac185c453392d3d0834103e`: Auth real desde el navegador y juego con Supabase bloqueado aprobados. `SUPABASE_SECRET_KEY` y `REPLAY_WORKER_SECRET` están guardadas como variables estándar autorizadas, sin marcado de secreto, en todos los alcances y contextos. El readback oficial confirmó 24 variables. Cuenta recuperable, economía, rankings con premios, publicidad y compras permanecen apagados; guardar las claves no verifica SMTP/OTP ni replay alojado.

1. Crear o seleccionar el proyecto Supabase. Guardar su URL y clave **publishable**; `anon` legacy es compatible. Nunca poner `sb_secret_...`, `service_role`, contraseñas ni secretos en `VITE_*`.
2. En Authentication, habilitar **Anonymous Sign-Ins**, proveedor **Email** y **Allow manual linking** para convertir la sesión anónima en cuenta con email. Configurar Site URL con la URL pública del juego y añadir únicamente los redirects de desarrollo y previews que se utilicen. [Auth anónima y vinculación](https://supabase.com/docs/guides/auth/auth-anonymous).
3. En Email Templates, incluir `{{ .Token }}` en **Magic Link** y **Change Email**. El juego introduce códigos: `email_change` al vincular y `email` al recuperar. Configurar SMTP para entrega real; probar códigos incorrectos, expirados y reenvíos. [OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [plantillas](https://supabase.com/docs/guides/auth/auth-email-templates).
4. Aplicar únicamente las migraciones pendientes, en orden y respaldando primero un proyecto con datos. No repetir una migración ya aplicada:
   - `supabase/migrations/20261003021023_tower_backend.sql`
   - `supabase/migrations/20261003200135_tower_economy_v2.sql`
   - `supabase/migrations/20261003221035_tower_economy_indexes.sql`

   Las tres ya se aplicaron a `nmdesnqgpsbtcoluyajh`; el historial remoto se alineó con las versiones locales sin repetir SQL. Comprobar `supabase migration list --project-ref nmdesnqgpsbtcoluyajh` antes de futuros cambios. El [registro de reconciliación](../supabase/README.md#historial-reconciliado) conserva el mapeo y los guards.
5. Mantener `tower_private` y `tower_economy` fuera de los schemas expuestos en Data API. El frontend usa las RPC públicas autorizadas; `tower_account_api` se reserva a `service_role`. La migración V2 concede al servidor SELECT de `auth.users(id,email,email_confirmed_at)` explícitamente. Verificar permisos de columnas, RLS y advisors con sesiones diferentes. Una sesión anónima también tiene rol Postgres `authenticated`; ese rol por sí solo no demuestra email verificado.
6. Añadir las variables públicas en Netlify; usar alcance **Build** cuando el plan lo permita:

```dotenv
VITE_SUPABASE_URL=https://PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=CLAVE_PUBLICA
VITE_SERVER_ECONOMY_ENABLED=false
VITE_SERVER_RANKINGS_ENABLED=false
VITE_RANKING_PERIODS=daily
VITE_OBJECT_CATALOG=extended-30
```

`VITE_SUPABASE_ANON_KEY` solo se necesita si no se usa publishable. Recrear el build tras cambiar cualquier `VITE_*`. En la cuenta actual (`nf_team_dev`), el conector informó éxito al solicitar alcances granulares pero estos no persistieron; el SDK oficial confirmó después HTTP 403 por alcances específicos. URL y clave pública quedaron guardadas con todos los contextos y alcances. Las dos claves privadas también usan ahora todos los alcances y contextos, como variables estándar, por autorización explícita posterior del titular. Verificar siempre el valor realmente guardado, no solo la respuesta de upsert. [API oficial, `createEnvVars`](https://open-api.netlify.com/#operation/createEnvVars).

7. Configurar las credenciales privadas utilizadas por **Functions**, sin prefijo `VITE_`, antes de habilitar la cuenta online. En este sitio las dos claves ya están guardadas como variables estándar autorizadas, disponibles en todos los alcances y contextos. La configuración requerida conserva los servicios apagados:

```dotenv
SUPABASE_URL=https://PROYECTO.supabase.co
SUPABASE_SECRET_KEY=SECRETO_SOLO_SERVIDOR
APP_URL=https://URL-EXACTA-DEL-SITIO.netlify.app
REPLAY_WORKER_SECRET=SECRETO_ALEATORIO_DISTINTO
SERVER_ECONOMY_ENABLED=false
SERVER_RANKINGS_ENABLED=false
SERVER_RANKING_PERIODS=daily
SERVER_AD_REWARDS_ENABLED=false
SERVER_PAYPAL_ENABLED=false
SERVER_OBJECT_CATALOG=extended-30
```

`SUPABASE_SERVICE_ROLE_KEY` es el fallback legacy de `SUPABASE_SECRET_KEY`; no se configuró porque se utiliza la clave actual. No guardar claves privadas en Git, `netlify.toml`, HTML, consola ni assets. El titular autorizó expresamente mantener Free y guardarlas como variables estándar: `is_secret:false`, alcances `builds`, `functions`, `post_processing` y `runtime`, contexto `all`. El readback oficial confirmó las 24 variables y ambos valores exactos sin mostrarlos. La disponibilidad incluye builds y previews; el código actual las lee en Functions y Vite no las incluye por no tener prefijo `VITE_`. No usar estas credenciales de producción para pruebas económicas en previews. El rechazo previo HTTP 403 afectó a los alcances específicos; no demuestra que `is_secret` por sí solo requiera Pro. No se cambió el plan ni los flags. El deploy `6ac19110c15b35c484fe3acf` está publicado y su bundle se comprobó sin claves privadas; los resultados están en [VALIDATION.md](../VALIDATION.md#seguimiento-del-guardado-de-secretos).

Comprobar en Netlify y en el build publicado que `VITE_SERVER_ECONOMY_ENABLED=false`, `VITE_SERVER_RANKINGS_ENABLED=false`, `VITE_PAYPAL_ENABLED=false`, `VITE_AD_PROVIDER=none` y `VITE_GOOGLE_CMP_CONFIGURED=false`. Los flags del servidor deben seguir en `false` si se configuran; una respuesta exitosa del conector no demuestra persistencia ni disponibilidad en Functions.

8. En un entorno de pruebas, habilitar `VITE_SERVER_ECONOMY_ENABLED=true` y `SERVER_ECONOMY_ENABLED=true`; reconstruir y desplegar allí. Vite dev/preview no ejecuta Netlify Functions por sí solo.
9. Probar: wallet anónimo en cero → email verificado sin cambiar propietario → starter de 100 coins una sola vez; segundo navegador → acceso con OTP → mismo saldo e inventario; email de otra cuenta → recuperación de esa cuenta, sin fusionar coins. Compras, inventario y recompensas requieren email confirmado. El perfil local y el wallet online se mantienen separados.

El público mínimo es 13 años. Las funciones online de 13–17 requieren autorización real del adulto responsable. El dato local es una declaración, no una verificación de edad o tutela. La normativa uruguaya no se reemplaza por un umbral genérico europeo de 16 años. Antes del lanzamiento comercial, revisar deberes de registro de bases, transferencias internacionales y atención de derechos con la [URCDP](https://www.gub.uy/unidad-reguladora-control-datos-personales).

### SMTP: pendiente

Estado al 3 de octubre de 2026: el titular confirmó que no tiene proveedor SMTP. El proyecto Free rechazó la modificación de plantillas con HTTP 400 porque usa el proveedor de email predeterminado; el mensaje indicó SMTP propio como alternativa. Las plantillas OTP y la entrega real siguen pendientes. La cuenta y economía del frontend permanecerán apagadas hasta comprobar el email real. No es necesario proponer una ampliación de pago de Supabase para resolver este pendiente: primero se configurará SMTP propio.

El SMTP incluido por Supabase no es para producción: solo envía a direcciones de miembros del equipo del proyecto y actualmente limita a dos mensajes por hora. No habilita el acceso de jugadores por email. [Restricciones oficiales](https://supabase.com/docs/guides/auth/auth-smtp).

Para este proyecto en Uruguay recomiendo **Resend** por su integración SMTP documentada con Supabase; **Brevo** es una alternativa compatible. Son opciones técnicas, sin alta ni contratación realizada: el titular debe completar el registro y validación del proveedor elegido. No se verificó una cuenta SMTP del titular ni se garantiza su aprobación. No hace falta utilizar ambos.

1. Elegir un dominio o subdominio propio para el remitente y disponer de acceso a sus DNS. `newsolutions.uy@gmail.com` es el contacto actual; no demuestra propiedad de un dominio para autenticación de correo. Resend requiere un dominio propio verificado, no Gmail ni `netlify.app`. [Dominios Resend](https://resend.com/docs/dashboard/domains/introduction).
2. Crear/verificar la cuenta del proveedor, registrar el dominio y publicar los registros exactos que indique para autenticación. Confirmar el estado verificado antes de usar un remitente de ese dominio. Desactivar tracking de apertura/clics para los mensajes de acceso.
3. Obtener las credenciales del proveedor elegido:
   - Resend: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña **API key**. [Integración oficial](https://resend.com/docs/send-with-supabase-smtp).
   - Brevo: host `smtp-relay.brevo.com`, puerto `587` o el indicado en su panel, usuario **SMTP login** del panel y contraseña **SMTP key**, que no es su API key. Autenticar dominio y remitente. [SMTP Brevo](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).
4. En el proyecto `nmdesnqgpsbtcoluyajh`, abrir [SMTP Settings](https://supabase.com/dashboard/project/nmdesnqgpsbtcoluyajh/auth/smtp), habilitar Custom SMTP y completar host, puerto, usuario, contraseña, remitente verificado y nombre `Impossible Tower`. Estas credenciales van en Supabase Auth: no en `VITE_*`, Netlify ni Git.
5. Tras guardar SMTP, volver a Email Templates y completar **Magic Link** y **Change Email** con `{{ .Token }}`. Confirmar que el proyecto acepta el cambio. Usar mensajes breves de acceso, sin publicidad.
6. Con autorización para enviar pruebas, comprobar entrega y código OTP en una dirección controlada por el titular que no dependa de la lista del equipo. Probar vinculación, recuperación desde otro navegador, código erróneo/expirado y reenvío; revisar logs y spam. Ajustar los límites de Auth al proveedor antes de abrir al público. Hasta pasar estas pruebas no activar cuenta/economía del frontend.

Mínimo pendiente del titular: proveedor elegido, cuenta validada, dominio y acceso DNS, remitente autorizado y credenciales SMTP guardadas de forma privada. No se enviaron emails ni se crearon cuentas SMTP en esta revisión.

## 2. Rankings y ayudas online

1. Completar la etapa de cuentas, replay y wallet antes de activar premios.
2. Elegir `SERVER_OBJECT_CATALOG=extended-24` para probar A o `extended-30` después de verificar B. El primer ticket congela el catálogo del Daily y cambios posteriores solo afectan días nuevos. Las secuencias de un mismo evento deben coincidir.
3. Activar `VITE_SERVER_RANKINGS_ENABLED=true` y `SERVER_RANKINGS_ENABLED=true` en pruebas, con `VITE_RANKING_PERIODS=daily` y `SERVER_RANKING_PERIODS=daily`. Comprobar primero el evento diario y sus premios contra `/reglas-ranking/`. Tras comprobar un cierre semanal, ampliar ambos valores a `daily,weekly`; habilitar `daily,weekly,monthly` después de verificar el cierre mensual. La opción visible y el período habilitado en servidor deben coincidir. No se anuncian premios de períodos desactivados.
4. Verificar `replay-background`, su autorización interna y el estado pendiente/aceptado/rechazado. Probar envío repetido, ayudas simultáneas, tick inválido, vencimiento y compensación por timeout.
5. Verificar la función programada `settle`: cada cinco minutos, UTC, despacha `replay-background` y `settle-background`; ambos requieren `REPLAY_WORKER_SECRET`. El segundo procesa como máximo tres períodos, cien timeouts y cien tickets vencidos por ejecución; un período conserva premios y cierre atómicos. Netlify ejecuta schedules en deploys publicados; un preview no prueba la ejecución automática del cron. Usar **Run now** en la página Functions para una comprobación manual: las funciones programadas no se invocan por URL en producción. Verificar logs de los workers, cierre diario, semanal y mensual, repetición sin duplicar coins, desempates y mínimos de participantes. [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).

Los límites y operaciones online se resuelven en servidor. El replay valida el resultado de la simulación; no identifica a una persona ni impide bots, cuentas múltiples o búsqueda automatizada de movimientos.

## 3. Google H5 y consentimiento

Estado al 3 de octubre de 2026: el titular confirmó que ya tiene AdSense; la aprobación específica de H5 sigue pendiente. No se verificaron anuncios reales. El SDK externo de una CMP todavía requiere selección e integración. Mantener `VITE_AD_PROVIDER=none`, `VITE_GOOGLE_CMP_CONFIGURED=false` y `SERVER_AD_REWARDS_ENABLED=false` mientras falten estos pasos.

1. Comprobar que la cuenta AdSense y el sitio real están aprobados. Solicitar acceso específico a **H5 Games Ads** mediante el [formulario vigente](https://adsense.google.com/start/h5-game-ads-apply/?src=devsite), usando el publisher y la URL real. Tener AdSense no equivale a tener H5 aprobado; esperar la confirmación de Google. [Requisitos oficiales](https://developers.google.com/ad-placement/docs/signup).
2. Publicar `/privacidad/`, `/terminos/` y `/reglas-ranking/`. Las páginas generadas no cargan anuncios ni el juego.
3. Seleccionar una CMP registrada y actualmente certificada por Google **para sitios web**; comprobar su ID real en la configuración del proveedor. La certificación de Google no acredita por sí sola cumplimiento de todas las leyes. Google CMP figura con ID 300: usar ese número solo si se integra efectivamente esa CMP. [Requisitos y lista vigente](https://support.google.com/adsense/answer/13554116?hl=es).
4. Integrar el **SDK oficial de esa CMP** en el flujo autorizado para adultos. Este proyecto conecta con `window.__tcfapi`; no descarga ni configura el SDK externo. No pegar un script publicitario global antes de determinar edad y consentimiento. Ofrecer acceso a las preferencias de la CMP y revocación.
5. Configurar la CMP para determinar el alcance aplicable, sin inferirlo desde el país declarado del jugador. Si devuelve `gdprApplies=true`, el adaptador exige CMP ID coincidente, estado completo, TCF vigente, Google Advertising Products **755** declarado, consentimiento para propósitos **1, 3, 4**, y base permitida para **2, 7, 9, 10**, respetando restricciones del publisher. Las strings nuevas requieren TCF **2.3** desde marzo de 2026. Si devuelve explícitamente `gdprApplies=false`, puede habilitar el flujo fuera de GDPR, incluyendo Uruguay, únicamente con esa misma CMP identificada y cargada y la aceptación local del adulto. Si faltan los estados en TCData, se verifica el estado mediante `__tcfapi('ping', 2)`, como permite la especificación. Un alcance desconocido sigue bloqueado. Este adaptador no implementa GPP ni otras APIs regionales: configurar y comprobar en la CMP los requisitos de los países atendidos. [Integración Google](https://support.google.com/adsense/answer/9804260), [errores TCF](https://support.google.com/adsense/answer/9999955), [API IAB](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md).
6. Configurar Build inicialmente con anuncios apagados:

```dotenv
VITE_PLATFORM=standalone
VITE_AD_PROVIDER=none
VITE_GOOGLE_ADSENSE_CLIENT=ca-pub-ID-REAL-DE-16-DIGITOS
VITE_GOOGLE_ADSENSE_CHANNEL=
VITE_GOOGLE_CMP_CONFIGURED=false
VITE_GOOGLE_CMP_ID=
VITE_GOOGLE_H5_TEST_MODE=false
```

`VITE_GOOGLE_CMP_CONFIGURED=true` es una atestación del operador de que integró y verificó la CMP certificada; no fabrica una certificación. Añadir su ID real. Mantener `none` hasta tener aprobación H5 y comprobar el consentimiento real.

7. En desarrollo o un Netlify Deploy Preview real, seleccionar `google-h5` y `VITE_GOOGLE_H5_TEST_MODE=true` para probar el SDK. Se usa `data-adbreak-test="on"`: es simulación y no concede coins. El build obtiene el contexto de Netlify; el modo de prueba queda bloqueado en producción. [Test oficial](https://developers.google.com/ad-placement/docs/test).
8. Probar edad desconocida, menores, rechazo, CMP ausente/ID distinto, aceptación, revocación durante anuncio, cancelación, timeout y orientación. H5 no inicializa sin adulto + elección local afirmativa + consentimiento vigente de la CMP.
9. Solo tras aprobación y verificación reales, activar `google-h5` con test mode **false**. En **AdSense → Sitios → sitio → Fragmento de ads.txt**, copiar la línea exacta del publisher real y publicarla en `/ads.txt`; comprobar contenido público y estado en AdSense. Google lo recomienda, aunque su guía no lo presenta como requisito universal. No inventar un publisher ni una línea para superar validaciones. [Guía ads.txt](https://support.google.com/adsense/answer/12171612?hl=es).

Mínimo pendiente del titular: confirmación de aprobación H5, publisher real (`pub-…` en **Cuenta → Configuración → Información de la cuenta**, `ca-pub-…` para el juego), URL aprobada, CMP elegida y su configuración/SDK, y fragmento ads.txt real. La política del proyecto sigue siendo anuncios solo para adultos; tener público 13+ no habilita publicidad para adolescentes. [Encontrar publisher](https://support.google.com/adsense/answer/105516?hl=es).

Mantener `SERVER_AD_REWARDS_ENABLED=false` hasta decidir y documentar el riesgo de acreditar anuncios online. H5 confirma desde callbacks del navegador, sin comprobante firmado SSV. El endpoint limita e identifica operaciones y rechaza simulaciones declaradas; un cliente modificado puede falsificar esos campos. Activar este flag no convierte un callback en evidencia autoritativa de visualización. Las coins recompensadas no son dinero, no se transfieren y solo se usan en este juego. [Política de rewarded ads](https://support.google.com/adsense/answer/9121589).

## 4. Compra de coins con PayPal USD

Estado al 3 de octubre de 2026: no hay aprobación Live acreditada ni app, credenciales o webhook Sandbox verificados para este proyecto. El plugin disponible gestiona facturas y links, pero no crea apps Developer ni webhooks. La inspección del navegador falló antes de acceder a la cuenta. No se hicieron cargos, compras ni envíos de mensajes. Mantener compras desactivadas y `PAYPAL_LIVE_APPROVED=false`.

1. Usar una cuenta **PayPal Business de Uruguay**, verificar titular y capacidad de recibir cobros. Consultar países y medios de pago admitidos para compradores; no prometer aceptación universal. [Checkout Uruguay](https://www.paypal.com/uy/business/accept-payments/checkout).
2. Solicitar y conservar aprobación escrita de PayPal para vender moneda de juego antes de habilitar cobros reales. Explicar que las coins solo sirven dentro de Impossible Tower, no se transfieren ni rescatan por dinero y que los rankings tienen entrada gratuita y premios virtuales. La política incluye virtual in-game currencies entre actividades con preaprobación. El contacto debe realizarlo el titular desde [Ventas Uruguay](https://www.paypal.com/uy/business/contact-sales) o su canal de atención de cuenta; no se envió la solicitud en esta revisión. [Acceptable Use Policy](https://www.paypal.com/legalhub/acceptableuse-full).
3. En **Developer Dashboard → Apps & Credentials → Sandbox → Create App**, crear una app para Impossible Tower. Obtener comprador Personal y vendedor Business de prueba desde **Testing Tools → Sandbox Accounts**. Entrar con el vendedor a `sandbox.paypal.com`; obtener Merchant ID en **Account Settings → Business information → PayPal Merchant ID**. [Apps y cuentas Sandbox](https://developer.paypal.com/api/rest/), [Merchant ID](https://developer.paypal.com/docs/multiparty/seller-onboarding/build-onboarding/). En los ajustes de la app, crear webhook HTTPS hacia `https://DOMINIO/api/paypal-webhook` y guardar su Webhook ID, con estos eventos:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `PAYMENT.CAPTURE.REVERSED`
4. Definir la configuración de credenciales PayPal antes de guardarlas para Functions; estos valores todavía están pendientes. La autorización para las dos claves de Supabase/replay no configura credenciales PayPal:

```dotenv
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=ID-SANDBOX
PAYPAL_CLIENT_SECRET=SECRETO-SANDBOX
PAYPAL_WEBHOOK_ID=ID-WEBHOOK-SANDBOX
PAYPAL_MERCHANT_ID=ID-DEL-VENDEDOR-SANDBOX
SERVER_PAYPAL_ENABLED=false
PAYPAL_LIVE_APPROVED=false
```

5. En pruebas, activar `SERVER_PAYPAL_ENABLED=true`, `VITE_PAYPAL_ENABLED=true` y `VITE_PAYPAL_ENVIRONMENT=sandbox`. Mantener APP_URL apuntando al mismo entorno. Los packs actuales son 200 coins/USD 2.99, 600/USD 6.99 y 1400/USD 12.99; importes/cantidades los fija el servidor.
6. Con las cuentas Sandbox, probar creación repetida, cancelación, retorno sin pagar, captura repetida, webhook duplicado, firma incorrecta, importe/moneda/destinatario incorrectos, devolución parcial/total, reversión fuera de orden y coins ya gastadas. El retorno del checkout por sí solo no acredita saldo. La Function captura y consulta la orden y captura canónicas con PayPal, valida propietario, importe USD y Merchant ID y acredita una sola vez. El webhook verifica su firma y concilia usando la misma captura para evitar duplicados, aunque llegue antes o después. El Webhook Simulator no demuestra este flujo: sus eventos mock no admiten el postback `verify-webhook-signature` usado por el proyecto; usar compras y devoluciones de prueba Sandbox, sin dinero real. [Webhooks REST](https://developer.paypal.com/api/rest/webhooks/rest/).
7. Revisar Privacidad/Términos y el canal `newsolutions.uy@gmail.com` antes de aceptar dinero. Informar precio total, moneda, entrega y retracto aplicable; no usar “sin reembolsos” como regla general. [Ley 17.250, artículo 16](https://www.impo.com.uy/bases/leyes/17250-2000/16).
8. Después de aprobación y pruebas, crear app y webhook **Live**, reemplazar Client ID, Client Secret, Webhook ID y Merchant ID por los del vendedor real y pasar `PAYPAL_ENVIRONMENT=live` y `VITE_PAYPAL_ENVIRONMENT=live`. Mantener `PAYPAL_LIVE_APPROVED=false` hasta recibir la aprobación real del proveedor; solo entonces cambiarlo a `true` en Functions. Es una atestación del operador, no una certificación automática. `SERVER_PAYPAL_LIVE_APPROVED` es su alias compatible: usar un solo nombre. Las compras se ofrecen solo a adultos con email verificado. No compartir secretos sandbox/live ni habilitar Live en un preview.

Mínimo pendiente del titular: cuenta Business verificada, acceso a Developer, Client ID/Secret Sandbox, Merchant ID del vendedor Sandbox y Webhook ID del mismo entorno, además de la solicitud/aprobación para coins antes de Live. Los secretos deben cargarse por un canal privado; no pegarlos en mensajes, frontend ni repositorio. Las credenciales Sandbox no acreditan aprobación comercial.

Stripe no admite actualmente alta directa de comerciantes uruguayos; esta implementación usa PayPal y no exige constituir una empresa extranjera. [Disponibilidad Stripe](https://stripe.com/global).

## 5. Publicación y fallos externos

Usar un proyecto Supabase y credenciales PayPal distintos en pruebas y producción. La configuración actual de Netlify usa todos los contextos, incluidos previews: no activar pruebas económicas allí con las claves de producción. Separar las credenciales de pruebas antes de ampliar flags y comprobar su persistencia. APP_URL debe identificar el entorno correcto. Recrear build/deploy al cambiar configuración. No activar todos los flags a la vez.

Verificar en la URL pública: legales, sesión recuperada en otro navegador, saldo sin importar coins locales, replay y liquidación UTC; después anuncios aprobados y finalmente un pago y devolución reales controlados. Registrar fecha, entorno y resultado. Probar también actualización de PWA instalada y teléfonos físicos.

Si Auth, wallet, anuncios o pagos fallan, el juego local continúa. No aplicar créditos online optimistas, premios ficticios ni pagos desde un callback del frontend. Mostrar operaciones pendientes y permitir reintentos idempotentes. Mantener flags apagados ante una integración incompleta.
