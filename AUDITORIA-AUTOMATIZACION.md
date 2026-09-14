# CreditFlow — Revisión completa y arquitectura automática

## Objetivo

Convertir el uso normal en:

**ID → Cliente → Reporte → Análisis → Estrategia → Cartas → Aprobación → Certified Mail → Tracking → Nuevo reporte → Remociones → Ganancia**

El operador no debería decidir manualmente qué pantalla visitar después.

## Lo que ya está bien y se conserva

- Cliente y portal.
- ID con Workers AI.
- Documentos ID / domicilio / SSN.
- Parser por coordenadas para Premium Credit Bureau / CreditXpert.
- Detección de colecciones, charge-offs, late payments, inquiries y otras categorías.
- Dirección histórica y scores.
- Un ítem por buró.
- Estrategia Paso 0 → Ronda 1 → Ronda 2 → Ronda 3 → acreedor.
- Batch CSV para Certified Mail Labels.
- USPS tracking.
- Cálculo de tarifas.

## Lo que hay que mejorar

### Crítico
1. Contraseña temporal `test1234` compartida por todos los clientes.
2. Remoción basada solo en ausencia del último parse: puede dar falsos positivos.
3. Importar un reporte viejo puede revivir ítems.
4. Ganancia depende de estado reversible en vez de evento histórico.
5. La espera de rondas usa fecha de actualización de carta, no fecha real de envío/entrega.
6. Plantillas tienen placeholders manuales que pueden llegar al envío.
7. Solo un formato de reporte está soportado.

### Automatización
8. El OCR no da confianza por campo.
9. No existe un "siguiente paso" único del caso.
10. La estrategia vive en frontend; debería ser backend/state machine.
11. El envío a Certified Mail Labels todavía requiere descargar/subir CSV y copiar tracking.
12. No hay un preflight global de carta/lote.

### Organización
13. Hay archivos JS duplicados fuera y dentro de `/sections`; mantener una sola fuente.
14. `src/index.js` concentra demasiado código; dividir por módulos progresivamente.
15. Documentos sensibles almacenados como base64 en DB; a escala es mejor almacenamiento de objetos.

## Diseño final recomendado

### Estado del caso
Cada cliente debe tener un estado calculado:

- `needs_identity`
- `needs_documents`
- `needs_report`
- `report_review`
- `strategy_ready`
- `letters_ready`
- `mailing_ready`
- `waiting_for_delivery`
- `waiting_for_new_report`
- `removals_detected`
- `completed`

### Botón principal
La ficha del cliente siempre muestra UN botón:
- “Subir ID”
- “Subir reporte”
- “Preparar cartas”
- “Aprobar lote”
- “Actualizar tracking”
- “Subir reporte actualizado”

### Regla de automatización
CreditFlow prepara y valida automáticamente.
El usuario solo aprueba el lote antes de gastar postage/enviar correspondencia.

## Certified Mail Labels

Su sitio actual ofrece API y SFTP para:
- transferir sender/recipient;
- crear etiquetas;
- asignar tracking;
- procesar batches;
- devolver tracking/proof records.

Por lo tanto, la meta final puede ser:
**Aprobar lote → CreditFlow manda a Certified Mail Labels → tracking vuelve solo.**

Para implementarlo hacen falta las credenciales y documentación aprobada de su API/SFTP.
Hasta entonces, mantener el Excel/CSV batch actual como fallback.
