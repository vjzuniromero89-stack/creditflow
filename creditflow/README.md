# CreditFlow

App interna para gestionar clientes de reparación de crédito: clientes, ítems negativos del
reporte de crédito, plantillas de cartas de disputa, cartas, envíos certificados (USPS) y un
portal de solo lectura para que cada cliente vea el avance de su caso.

## Sobre este repositorio

Este proyecto vivía originalmente en Cloudflare Pages (`creditflow-9n9.pages.dev`), sin estar
conectado a ningún repositorio de Git ni desplegado con Wrangler — se subía arrastrando los
archivos al dashboard. Tanto el **frontend** (`public/`) como el **backend real**
(`src/index.js`, el antiguo `_worker.js`) son el código original del proyecto, sin reescribir —
solo se adaptó lo necesario para desplegarlo con Wrangler como un Worker normal:

- Se movió `_worker.js` a `src/index.js` y se creó `wrangler.jsonc` (bindings de D1, Workers AI
  y Workers Assets, apuntando a los mismos recursos de Cloudflare que ya existían).
- Se escribió `schema.sql` con el esquema completo de la base de datos D1, deducido leyendo cada
  consulta SQL del propio backend (la base D1 del proyecto original estaba vacía — 0 tablas — al
  momento de esta migración).
- Se actualizaron un puñado de textos y mensajes de error que mencionaban "Cloudflare Pages" para
  que digan "Cloudflare Workers"/reflejen la nueva forma de desplegar (por ejemplo, dónde
  configurar las variables de entorno). Ningún comportamiento cambió.

El backend no usa ninguna dependencia externa (ni Hono, ni librerías de PDF/DOCX/ZIP) — todo el
manejo de PDFs, documentos Word, hashing de contraseñas y tokens de sesión está escrito con las
APIs estándar de Web (Web Crypto, `DecompressionStream`, etc.), por eso cabe en un solo archivo.

Antes de depender de esto en producción, vale la pena revisar:

- **Rastreo USPS**: funciona igual que antes; si configuras `USPS_CLIENT_ID` /
  `USPS_CLIENT_SECRET`, confirma que el rastreo automático se comporte como esperas. Sin esas
  variables, todo sigue funcionando con actualización manual del estado.
- **Extracción con IA** (foto de ID → datos del cliente): usa el modelo de Workers AI
  `@cf/moondream/moondream3.1-9B-A2B` y es "best-effort" — siempre revisa el resultado antes de
  guardar, tal como ya indica la propia interfaz.
- **`SESSION_SECRET`**: es un valor nuevo (el original no se pudo recuperar), así que cualquier
  sesión que hubiera quedado iniciada en el sitio antiguo no es válida aquí — no afecta a los
  datos guardados, solo obliga a volver a iniciar sesión.

Ver **INSTRUCCIONES.md** para los pasos de instalación y despliegue.

## Estructura

```
public/             Frontend (código original, tal cual)
src/index.js         Backend (código original, tal cual — antes _worker.js)
schema.sql           Esquema completo de la base D1 (nuevo, deducido del backend)
wrangler.jsonc        Configuración del Worker (assets + D1 + Workers AI)
INSTRUCCIONES.md      Guía de instalación y despliegue
```

## Desarrollo local

```bash
npm install
npm run db:migrate:local   # crea las tablas en la base D1 local
npm run dev
```

## Desplegar

```bash
npm run db:migrate:remote  # solo la primera vez, o tras cambiar schema.sql
npm run deploy
```

Al abrir la app por primera vez te pedirá crear tu cuenta de administrador (pantalla de
"configuración inicial") — no viene ningún usuario precargado.
