# PATCH: sections/clients.js

## Flujo recomendado al crear cliente

1. Pantalla inicial: arrastrar/tomar foto del ID.
2. Mientras IA analiza, mostrar skeleton.
3. Mostrar formulario ya rellenado.
4. Campos detectados con alta confianza: borde verde.
5. Campos dudosos: borde ámbar y texto "revisar".
6. Al guardar:
   - guarda cliente;
   - guarda ID;
   - crea portal;
   - lleva directamente a la ficha del cliente;
   - abre el paso siguiente: "Subir reporte de crédito".

## Después de importar un reporte

Hoy solo muestra un toast. Cambiar el final del handler para:
1. mostrar un resumen:
   - colecciones
   - charge-offs
   - late payments
   - inquiries
   - direcciones
   - scores
   - remociones detectadas
2. ofrecer una sola acción principal:
   `Analizar estrategia y preparar cartas`
3. llamar `runSmartGenerateForClient(id, ...)`.
4. las cartas válidas pasan a "Preparadas"; las que tengan blockers quedan como borrador.

NO enviar automáticamente todavía: el último paso debe ser "Aprobar y enviar lote".
