# Acceso de Julia a Railway (Producción)

> Estado: guía operativa vigente para permitir que Julia (clawdbot) revise Railway de producción con el menor riesgo posible.

## Objetivo

Permitir que Julia consulte Railway de producción sin exponer secretos ni darle capacidad de cambiar deploys, variables o configuración sensible.

## Recomendación principal

La forma más segura es conectar a Julia por API usando OAuth de Railway con alcance mínimo:

- `openid`
- `project:viewer`
- opcional `offline_access` solo si Julia necesita reconectarse sin intervención humana

Ese acceso debe limitarse al proyecto específico de producción de Revenio, no al workspace completo.

## Qué sí debe hacer Marina

1. Confirmar si Julia soporta conexión OAuth genérica contra Railway.
2. Si sí soporta OAuth, autorizar únicamente el proyecto de producción con rol viewer.
3. Si no soporta OAuth, crear una identidad separada para Julia y agregarla como `Viewer` al proyecto.
4. Activar 2FA obligatorio en Railway para cualquier identidad humana que tenga acceso al workspace.
5. Revocar el acceso cuando termine la revisión o cuando deje de ser necesario.

## Qué no se debe hacer

- No compartir la cuenta personal de Marina dentro de Julia.
- No darle a Julia acceso `Editor` o `Member`.
- No darle acceso al workspace completo si solo necesita un proyecto.
- No usar tokens personales amplios de Marina para que Julia opere sola.

## Opción A: OAuth de Railway para Julia (recomendada)

Esta es la mejor opción cuando Julia puede autenticarse como app externa.

### Scopes recomendados

- `openid`
- `project:viewer`

Scope opcional:

- `offline_access`

Usar `offline_access` solo si Julia necesita guardar refresh token para revisar Railway sin volver a pedir login. Si la revisión es puntual o supervisada, es mejor no usarlo.

### Resultado esperado

Julia puede consultar Railway por API con acceso de solo lectura al proyecto compartido.

Con esta configuración:

- puede leer recursos permitidos por el scope viewer
- no puede hacer deploys
- no puede modificar configuración
- no debería ver environment variables si el acceso efectivo es viewer

### Pasos para Marina

1. Abrir la integración o conector de Julia para Railway.
2. Elegir Login with Railway.
3. Autorizar solo estos scopes:
   - `openid`
   - `project:viewer`
   - `offline_access` solo si es estrictamente necesario
4. En la pantalla de consentimiento de Railway, compartir únicamente el proyecto de producción de Revenio.
5. Completar la conexión.
6. Verificar dentro de Julia que solo pueda consultar el proyecto correcto.
7. Guardar una nota interna con:
   - fecha de autorización
   - proyecto compartido
   - scopes aprobados
   - responsable

### Cuándo revocarlo

Revocar si:

- Julia deja de usar Railway
- cambian de herramienta
- hubo duda de seguridad
- la revisión ya terminó

La revocación se hace desde Railway en la sección de apps autorizadas.

## Opción B: cuenta separada para Julia como Viewer

Usar esta opción solo si Julia no soporta OAuth con scopes de Railway.

### Resultado esperado

Julia entra con una identidad separada dedicada al bot y con permisos `Viewer` en el proyecto.

### Pasos para Marina

1. Crear una identidad separada para Julia.
   - No reutilizar la cuenta personal de Marina.
2. Invitar esa identidad al proyecto de producción de Revenio.
3. Asignar rol `Viewer`.
4. Verificar que:
   - no puede hacer deploy
   - no puede editar settings
   - no puede ver environment variables
5. Si Railway lo permite en el plan actual, exigir 2FA para cuentas humanas del workspace.
6. Guardar quién creó la cuenta, para qué sirve y cuándo se debe desactivar.

### Cuándo usar esta opción

- Julia no soporta OAuth de Railway
- Julia necesita entrar por interfaz en lugar de API
- se requiere una solución rápida y controlada

## Qué puede revisar Julia

Si el objetivo real es observabilidad, Julia debería limitarse a revisar:

- estado de servicios
- health del proyecto
- logs
- estado de deploys
- métricas visibles

No necesita acceso para:

- editar variables
- redeployar manualmente
- tocar dominios
- tocar base de datos
- cambiar permisos de otros usuarios

## Checklist de seguridad para Marina

- Julia usa identidad separada o OAuth propio
- Acceso limitado al proyecto de producción, no al workspace completo
- Rol o scope efectivo: `Viewer`
- Sin secrets compartidos manualmente
- Sin tokens personales de Marina dentro del agente
- Acceso documentado
- Revocación definida

## Fuentes oficiales de Railway

- Project members:
  [https://docs.railway.com/projects/project-members](https://docs.railway.com/projects/project-members)
- Login & tokens:
  [https://docs.railway.com/integrations/oauth/login-and-tokens](https://docs.railway.com/integrations/oauth/login-and-tokens)
- Scopes & user consent:
  [https://docs.railway.com/integrations/oauth/scopes-and-user-consent](https://docs.railway.com/integrations/oauth/scopes-and-user-consent)
- Authorized apps:
  [https://docs.railway.com/integrations/oauth/authorized-apps](https://docs.railway.com/integrations/oauth/authorized-apps)
- Two-factor enforcement:
  [https://docs.railway.com/access/two-factor-enforcement](https://docs.railway.com/access/two-factor-enforcement)

## Decisión recomendada para Revenio

Para Revenio, la decisión recomendada es:

1. Intentar primero OAuth con `project:viewer`.
2. Si Julia no soporta ese flujo, usar cuenta separada `Viewer`.
3. Evitar por completo compartir la cuenta personal de Marina con Julia.
