# CreditFlow — mejoras visuales listas para GitHub

He preparado una capa visual global para corregir desalineaciones sin tocar la lógica de la app.

## Archivos

1. `creditflow/public/assets/css/ui-polish.css`
   - Archivo NUEVO.
   - Agrégalo a esa ruta exacta.

2. `creditflow/public/index.html`
   - REEMPLAZA el archivo existente.
   - El único cambio funcional es cargar `ui-polish.css` después de `styles.css`.

## Qué corrige

- Tarjetas KPI con alturas uniformes.
- Números y cantidades con tipografía financiera consistente.
- Cuadros de Ganancias con altura, padding y cifras consistentes.
- Tablas con columnas numéricas alineadas.
- Botones de acción de tamaño consistente.
- Formularios y campos alineados.
- Encabezados y secciones con espaciado uniforme.
- Modales más organizados.
- Responsive mejorado para tablet.
- Vista móvil específica para 640 px y 390 px.
- Evita que textos largos deformen tarjetas o encabezados.
- No modifica API, Supabase, Cloudflare Worker ni la lógica JavaScript.

## Para GitHub

Puedes subir estos dos archivos respetando exactamente sus rutas.

Si GitHub pregunta si reemplazar `index.html`, acepta el reemplazo.
`ui-polish.css` es un archivo nuevo.
