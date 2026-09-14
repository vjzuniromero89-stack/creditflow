# PATCH: src/index.js — Automation v1

Estos cambios son deliberadamente aditivos. No borres el parser actual.

## 1. Seguridad: NO usar `test1234` para todos los clientes

Actualmente existe:

```js
const DEFAULT_PORTAL_PASSWORD = "test1234";
```

Reemplaza el uso de contraseña fija en `assignPortalCredentials()` por:

```js
function randomPortalPassword(len = 14) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@$";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

async function assignPortalCredentials(env, clientId, fullName, keepUsername) {
  const username = keepUsername || (await generateUniquePortalUsername(env, fullName));
  const password = randomPortalPassword();
  const { hash, salt } = await hashPassword(password);
  const plainEnc = await encryptSsn(env, password);
  await env.DB
    .prepare(
      `UPDATE clients SET portal_username = ?, portal_password_hash = ?, portal_password_salt = ?,
       portal_password_plain_enc = ?, portal_must_change_password = 1 WHERE id = ?`
    )
    .bind(username, hash, salt, plainEnc, clientId)
    .run();
  return { username, password };
}
```

## 2. Reportes: registrar cada importación y bloquear comparaciones peligrosas

ANTES de reconciliar/remover ítems:
- calcula SHA-256 del PDF;
- obtiene `parsed.reportDate`;
- consulta el último `report_imports.report_date`.

Reglas:
1. Si el mismo hash ya fue importado: no reconciliar y responder `duplicate_report: true`.
2. Si la fecha del nuevo reporte es anterior al último reporte: importar como histórico si deseas, pero **NO marcar ni revivir ítems**.
3. Si el parser detecta una caída anormal (>60% menos ítems que el reporte anterior): marcar `parser_status='review'` y **NO declarar remociones**.
4. Solo el reporte más nuevo y válido puede generar remociones.

Helper recomendado:

```js
async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

## 3. Remociones: hacerlas eventos permanentes

Cuando un ítem desaparezca del reporte válido más reciente:
- conservar `credit_items.removed_status='eliminado'` para compatibilidad;
- INSERTAR en `removal_events` con `ON CONFLICT DO NOTHING`;
- guardar la tarifa vigente en `amount`;
- Ganancias debe sumar `removal_events`, no depender solo del estado reversible del ítem.

Un reporte viejo nunca debe borrar un `removal_event`.

## 4. OCR de ID

El endpoint actual hace preguntas separadas por campo, lo cual está bien.
Mejorarlo con:
- dos lecturas para nombre/DOB/dirección;
- comparación entre ambas;
- `confidence` por campo;
- ZIP: aceptar solo `^\d{5}(-\d{4})?$`;
- state: validar contra los 50 códigos estatales;
- id_last4: exactamente 4 dígitos;
- devolver:
  `{ fields, confidence, warnings }`.

Frontend:
- auto-rellenar confianza >= 0.85;
- resaltar 0.60-0.84;
- dejar vacío < 0.60.

## 5. Report parser adapters

Mantener `pcb_creditxpert` y convertir `detectCreditReportFormat()` en registro:

```js
const REPORT_PARSERS = [
  { id: "pcb_creditxpert", detect: detectPcb, parse: parseCreditReportPCB },
  // próximos: identityiq, smartcredit, myscoreiq...
];
```

Un formato desconocido no debe crear/remover nada.

## 6. Estrategia de cartas

Mover gradualmente `planLettersForItem` del frontend al backend:
`GET /api/clients/:id/strategy`
y
`POST /api/clients/:id/strategy/generate`

La fecha de espera NO debe usar `letter.updated_at`.
Debe usar:
1. `mailings.delivered_at` si existe;
2. `mailings.mailed_at`;
3. solo como último fallback, fecha de carta.

## 7. Preflight antes de poner una carta en "lista"

Bloquear si:
- falta nombre/dirección/ciudad/estado/ZIP;
- falta ID o proof of address si la plantilla lo requiere;
- falta recipient_address;
- quedan placeholders `[FECHA ...]`, `[NÚMERO ...]` o `{{...}}`;
- la carta corresponde a un ítem ya eliminado;
- el reporte base no es el más reciente.

## 8. Certified Mail Labels

No inventar un endpoint. Su API/SFTP requiere credenciales y layout aprobados por Certified Mail Labels.
Cuando tengas las credenciales/docs:
- crear `src/certified-mail-labels.js`;
- enviar remitente/destinatario + referencia `CF-{letter_id}`;
- recibir tracking;
- registrar `mailings` automáticamente;
- actualizar estado sin copiar/pegar tracking.
