# CreditFlow Automatización v1

Este paquete NO reemplaza todavía todo `src/index.js`, porque el backend actual es muy grande y una sustitución parcial sería peligrosa.

## Puedes subir ahora

### 1. Reemplazar
`creditflow/public/assets/js/sections/documents.js`

Mejora Documentos:
- permite reanalizar el ID ya guardado;
- muestra lo detectado;
- completa solo campos vacíos o reemplaza con confirmación.

### 2. Agregar
`creditflow/public/assets/css/automation.css`

En `creditflow/public/index.html`, después de `styles.css`, agrega:

```html
<link rel="stylesheet" href="/assets/css/automation.css" />
```

Si ya instalaste `earnings-smart.css`, carga ambos.

### 3. Ganancias
Este paquete incluye la versión Ganancias Inteligente preparada anteriormente.

### 4. Base de datos
`creditflow/migrations/automation-v1.sql`

Es una migración ADITIVA para:
- report_imports
- removal_events
- automation_events

No borra tablas existentes.

## Todavía NO copies el contenido de PATCHES como archivo ejecutable

Los archivos dentro de `PATCHES/` son instrucciones de modificación para `src/index.js` y `sections/clients.js`.
Sirven para la siguiente actualización del backend.

## Prioridad recomendada

1. Seguridad de portal.
2. Report snapshots + removal events.
3. Preflight de cartas.
4. Estrategia backend.
5. Certified Mail Labels API.
