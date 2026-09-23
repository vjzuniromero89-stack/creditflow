# CreditFlow Motor de Caso v2

## Qué corrige primero

En la subida anterior:
- `documents.js` y `earnings.js` quedaron también en `public/assets/js/`, pero la app carga los archivos dentro de `/sections/`.
- `index.html` no estaba cargando `automation.css` ni `earnings-smart.css`.

Este ZIP trae las rutas correctas.

## Reemplazar / agregar exactamente

1. Reemplazar:
`creditflow/public/index.html`

2. Reemplazar:
`creditflow/public/assets/js/sections/documents.js`

3. Reemplazar:
`creditflow/public/assets/js/sections/earnings.js`

4. Agregar:
`creditflow/public/assets/js/sections/case-engine.js`

5. Agregar:
`creditflow/public/assets/css/case-engine.css`

6. Confirmar que existan:
`creditflow/public/assets/css/automation.css`
`creditflow/public/assets/css/earnings-smart.css`

7. Aplicar los 3 cambios pequeños de:
`APLICAR-CLIENTS.md`

## Qué hace el Motor de Caso

La ficha del cliente ahora decide automáticamente el siguiente paso:

- Completar cliente
- Subir ID
- Subir comprobante
- Subir reporte
- Preparar cartas
- Revisar cartas
- Ir a envío certificado
- Ver tracking
- Esperar 30 días
- Subir reporte actualizado
- Ver remociones/ganancias

También muestra un pipeline:
Identidad → Reporte → Estrategia → Envío → Resultados

## Importante

Este paso todavía NO envía cartas automáticamente.
La aprobación humana antes del envío se mantiene a propósito.

La siguiente fase será backend:
- report_imports realmente conectado al importador;
- removal_events permanente;
- bloqueo de reportes viejos/duplicados;
- preflight antes de marcar cartas como "lista";
- estrategia usando fecha real de mailing/delivery.
