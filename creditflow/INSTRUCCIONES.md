# CreditFlow — Guía de instalación (Cloudflare Workers)

Este proyecto se despliega con Wrangler. La base de datos D1 y el binding de Workers AI ya
están declarados en `wrangler.jsonc` (reutilizan los mismos recursos que el proyecto original
en Cloudflare Pages), así que solo faltan tres cosas antes del primer despliegue.

## 1. Instalar dependencias

```bash
npm install
```

## 2. Crear las tablas en D1

La primera vez (o después de cambiar `schema.sql`):

```bash
npm run db:migrate:remote
```

## 3. Configurar las variables de entorno / secretos

En el dashboard de Cloudflare: **Workers & Pages → creditflow → Settings → Variables and
Secrets**, o por línea de comandos:

- **`SESSION_SECRET`** (obligatorio) — clave usada para firmar las sesiones de login (del panel
  y del portal de clientes). Sin esta variable la app no deja iniciar sesión. Genera un valor
  aleatorio largo, por ejemplo:

  ```bash
  npx wrangler secret put SESSION_SECRET
  # pega un valor generado con: openssl rand -base64 48
  ```

  Nota: si el proyecto original ya tenía usuarios con sesión iniciada, cambiar este valor cierra
  esas sesiones (tendrán que volver a iniciar sesión) — no borra ningún dato.

- **`USPS_CLIENT_ID`** / **`USPS_CLIENT_SECRET`** (opcional) — habilitan el rastreo automático de
  envíos certificados vía la API de USPS. Se consiguen gratis en
  [developer.usps.com](https://developer.usps.com). Sin ellas, la app sigue funcionando
  normalmente y el estado de los envíos se actualiza a mano.

  ```bash
  npx wrangler secret put USPS_CLIENT_ID
  npx wrangler secret put USPS_CLIENT_SECRET
  ```

## 4. Desplegar

```bash
npm run deploy
```

Al abrir la app por primera vez pedirá crear la cuenta de administrador (pantalla de
"configuración inicial") — no viene ningún usuario precargado. Desde **Ajustes** dentro de la
app puedes cargar las plantillas de cartas de ejemplo (disputa por rondas, validación de deuda,
goodwill, cese de comunicación, etc.) con un clic.

## Desarrollo local

```bash
npm run db:migrate:local   # crea las tablas en la base D1 local (una sola vez)
npm run dev
```

`SESSION_SECRET` para desarrollo local se puede poner en un archivo `.dev.vars` (no se sube a
Git):

```
SESSION_SECRET=cualquier-valor-para-pruebas-locales
```
