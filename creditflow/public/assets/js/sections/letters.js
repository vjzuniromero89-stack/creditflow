import { api } from "../api.js";
import { icon } from "../icons.js";
import { confirmDialog } from "../modal.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDate, formatDateTime, statusBadge, todayLong, LETTER_STATUS_FLOW, STATUS_META } from "../utils.js";
import { ACTION_LABELS } from "./dashboard.js";

const CERTIFIED_MAIL_URL = "https://www.certifiedmaillabels.com/create-address-label";

export function renderTemplate(body, map) {
  let out = body || "";
  Object.entries(map).forEach(([key, val]) => {
    out = out.split(`{{${key}}}`).join(val || `[${key}]`);
  });
  return out;
}

// El cliente guarda date_of_birth como "AAAA-MM-DD"; en la carta se muestra como MM/DD/AAAA
// (formato de fecha de nacimiento habitual en la correspondencia con los burós en EE.UU.).
export function formatDobForLetter(dateOfBirth) {
  const m = String(dateOfBirth || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [, yyyy, mm, dd] = m;
  return `${mm}/${dd}/${yyyy}`;
}

export function roundLabel(roundNumber) {
  return Number(roundNumber) === 0 ? "Información personal" : `Ronda ${roundNumber}`;
}

/* ------------------------------------------------------------------ */
/* Listado                                                             */
/* ------------------------------------------------------------------ */
export async function renderLettersList(container) {
  container.innerHTML = `
    <div class="section-head">
      <div class="tag-row" id="status-filters">
        <button class="pill-filter active" data-status="">Todas</button>
        ${LETTER_STATUS_FLOW.concat(["devuelta", "respondida"])
          .map((s) => `<button class="pill-filter" data-status="${s}">${STATUS_META[s].label}</button>`)
          .join("")}
      </div>
      <button class="btn btn-primary" id="new-letter-btn">${icon("plus")} Nueva carta</button>
    </div>
    <div class="table-wrap"><div id="letters-table"></div></div>
  `;

  let currentStatus = "";

  async function load() {
    const params = new URLSearchParams();
    if (currentStatus) params.set("status", currentStatus);
    const { letters } = await api.get(`/letters?${params.toString()}`);
    const box = document.getElementById("letters-table");
    if (!letters.length) {
      box.innerHTML = `<div class="empty"><div class="mark">✉️</div><h3>No hay cartas en este estado</h3></div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Carta</th><th>Cliente</th><th>Ronda</th><th>Estado</th><th>Rastreo</th><th>Actualizada</th></tr></thead>
        <tbody>
          ${letters
            .map(
              (l) => `
            <tr data-id="${l.id}">
              <td class="row-name">${escapeHtml(l.title)}</td>
              <td>${escapeHtml(l.client_name)}</td>
              <td>${roundLabel(l.round_number)}</td>
              <td>${statusBadge(l.status)}</td>
              <td class="row-sub">${l.tracking_number ? escapeHtml(l.tracking_number) : "—"}</td>
              <td class="row-sub">${formatDate(l.updated_at)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    box.querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", () => window.__creditflowNavigate(`#/cartas/${tr.dataset.id}`))
    );
  }

  document.querySelectorAll("#status-filters .pill-filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#status-filters .pill-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatus = btn.dataset.status;
      load();
    })
  );
  document.getElementById("new-letter-btn").addEventListener("click", () => window.__creditflowNavigate("#/cartas/nueva"));

  await load();
}

/* ------------------------------------------------------------------ */
/* Nueva carta                                                         */
/* ------------------------------------------------------------------ */
export async function renderNewLetter(container) {
  const [{ clients }, { templates }] = await Promise.all([api.get("/clients"), api.get("/templates")]);
  const prefillClientId = window.__prefillClientId || "";
  window.__prefillClientId = null;

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h3 style="font-size:15px;margin-bottom:16px">1. Datos de la carta</h3>
        <div class="form-grid">
          <div class="field" style="grid-column:1/-1">
            <label>Cliente *</label>
            <select id="f-client" required>
              <option value="">Selecciona un cliente</option>
              ${clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(prefillClientId) ? "selected" : ""}>${escapeHtml(c.full_name)}</option>`).join("")}
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Plantilla</label>
            <select id="f-template">
              <option value="">En blanco (escribir manualmente)</option>
              ${templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field" style="grid-column:1/-1"><label>Título interno *</label><input type="text" id="f-title" placeholder="Ej. Disputa Equifax - Ronda 1" required /></div>
          <div class="field"><label>Destinatario</label><input type="text" id="f-recipient-name" placeholder="Ej. Equifax Information Services" /></div>
          <div class="field"><label>Ronda</label><input type="number" id="f-round" value="1" min="1" /></div>
          <div class="field" style="grid-column:1/-1"><label>Dirección del destinatario</label><input type="text" id="f-recipient-address" placeholder="Ej. P.O. Box 740256, Atlanta, GA 30374" /></div>
          <div class="field"><label>Acreedor / cuenta</label><input type="text" id="f-acreedor" placeholder="Ej. Capital One" /></div>
          <div class="field"><label>Número de cuenta</label><input type="text" id="f-cuenta" placeholder="Ej. ****1234" /></div>
          <div class="field" style="grid-column:1/-1"><label>Motivo de la disputa</label><textarea id="f-motivo" style="min-height:70px" placeholder="Ej. This account does not belong to me / no reconozco esta cuenta"></textarea></div>
        </div>
        <button class="btn btn-primary btn-block" id="generate-btn" style="margin-top:18px">${icon("spark")} Generar carta con estos datos</button>
      </div>
      <div class="card">
        <div class="flex-between" style="margin-bottom:16px">
          <h3 style="font-size:15px">2. Contenido de la carta</h3>
        </div>
        <textarea id="f-body" style="min-height:360px" placeholder="El contenido generado aparecerá aquí. También puedes escribirlo o editarlo libremente."></textarea>
        <div class="form-actions">
          <button class="btn btn-ghost" id="cancel-btn" type="button">Cancelar</button>
          <button class="btn btn-primary" id="save-btn" type="button">Guardar carta</button>
        </div>
      </div>
    </div>
  `;

  function currentClient() {
    return clients.find((c) => String(c.id) === document.getElementById("f-client").value);
  }
  function currentTemplate() {
    return templates.find((t) => String(t.id) === document.getElementById("f-template").value);
  }

  document.getElementById("f-template").addEventListener("change", () => {
    const t = currentTemplate();
    if (t && !document.getElementById("f-title").value) {
      document.getElementById("f-title").value = t.name;
    }
    if (t && t.recipient_hint && !document.getElementById("f-recipient-name").value) {
      document.getElementById("f-recipient-name").value = t.recipient_hint;
    }
  });

  document.getElementById("generate-btn").addEventListener("click", () => {
    const client = currentClient();
    if (!client) {
      toast("Selecciona un cliente primero", "error");
      return;
    }
    const t = currentTemplate();
    const map = {
      cliente_nombre: client.full_name,
      cliente_direccion: client.address || "",
      cliente_ciudad_estado_zip: [client.city, client.state, client.zip].filter(Boolean).join(", "),
      cliente_id_last4: client.id_last4 || "",
      cliente_fecha_nacimiento: formatDobForLetter(client.date_of_birth),
      fecha: todayLong(),
      destinatario_nombre: document.getElementById("f-recipient-name").value,
      destinatario_direccion: document.getElementById("f-recipient-address").value,
      numero_cuenta: document.getElementById("f-cuenta").value,
      acreedor_nombre: document.getElementById("f-acreedor").value,
      motivo_disputa: document.getElementById("f-motivo").value,
      ronda: document.getElementById("f-round").value || "1",
    };
    if (t) {
      document.getElementById("f-body").value = renderTemplate(t.body, map);
    } else {
      document.getElementById("f-body").value = `${todayLong()}\n\n${client.full_name}\n${client.address || ""}\n\n${document.getElementById("f-recipient-name").value}\n${document.getElementById("f-recipient-address").value}\n\n`;
    }
  });

  document.getElementById("cancel-btn").addEventListener("click", () => window.__creditflowNavigate("#/cartas"));

  document.getElementById("save-btn").addEventListener("click", async () => {
    const clientId = document.getElementById("f-client").value;
    const title = document.getElementById("f-title").value.trim();
    const body = document.getElementById("f-body").value.trim();
    if (!clientId) return toast("Selecciona un cliente", "error");
    if (!title) return toast("Escribe un título interno", "error");
    if (!body) return toast("El contenido de la carta no puede estar vacío", "error");

    try {
      const t = currentTemplate();
      const { letter } = await api.post("/letters", {
        client_id: clientId,
        template_id: t ? t.id : null,
        title,
        recipient_name: document.getElementById("f-recipient-name").value,
        recipient_address: document.getElementById("f-recipient-address").value,
        round_number: Number(document.getElementById("f-round").value) || 1,
        body,
      });
      toast("Carta creada", "success");
      window.__creditflowNavigate(`#/cartas/${letter.id}`);
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Detalle de carta                                                     */
/* ------------------------------------------------------------------ */
export async function renderLetterDetail(container, id) {
  container.innerHTML = `<div class="card">Cargando...</div>`;
  const { letter, mailings, activity } = await api.get(`/letters/${id}`);
  const mailing = mailings[0];

  const needsIdCopy = !!letter.include_id_copy;
  const needsAddressProof = !!letter.include_address_proof;
  const needsSsnCopy = !!letter.include_ssn_copy;
  let clientDocs = [];
  if (needsIdCopy || needsAddressProof || needsSsnCopy) {
    try {
      const { documents } = await api.get(`/clients/${letter.client_id}/documents`);
      clientDocs = documents;
    } catch (err) {
      clientDocs = [];
    }
  }
  const docIdFile = clientDocs.find((d) => d.doc_type === "id");
  const docAddressFile = clientDocs.find((d) => d.doc_type === "proof_address");
  const docSsnFile = clientDocs.find((d) => d.doc_type === "ssn");
  const missingDocs = [];
  if (needsIdCopy && !docIdFile) missingDocs.push("identificación (ID)");
  if (needsAddressProof && !docAddressFile) missingDocs.push("comprobante de domicilio");
  if (needsSsnCopy && !docSsnFile) missingDocs.push("Social Security");

  const flowIndex = LETTER_STATUS_FLOW.indexOf(letter.status);
  const isAlt = ["devuelta", "respondida"].includes(letter.status);

  container.innerHTML = `
    <div class="flex-between no-print" style="margin-bottom:6px">
      <div class="text-sm text-muted">${escapeHtml(letter.client_name)} · ${roundLabel(letter.round_number)}</div>
      <div class="flex gap-8">
        <button class="btn btn-ghost btn-sm" id="print-btn">${icon("printer")} Imprimir / PDF</button>
        <button class="btn btn-danger btn-sm" id="delete-btn">${icon("trash")} Eliminar</button>
      </div>
    </div>

    <div class="stepper no-print">
      ${LETTER_STATUS_FLOW.map((s, i) => {
        const done = !isAlt && i < flowIndex;
        const current = !isAlt && i === flowIndex;
        return `${i > 0 ? `<div class="step-sep ${done || current ? "done" : ""}"></div>` : ""}<div class="step ${done ? "done" : ""} ${current ? "current" : ""}">${i === 0 ? icon("file") : i === 1 ? icon("check") : i === 2 ? icon("send") : i === 3 ? icon("truck") : i === 4 ? icon("mail") : icon("bolt")} ${STATUS_META[s].label}</div>`;
      }).join("")}
      ${isAlt ? `<div class="step-sep"></div><div class="step current">${icon("bolt")} ${STATUS_META[letter.status].label}</div>` : ""}
    </div>

    ${
      missingDocs.length
        ? `<div class="card no-print" style="border-color:var(--red);margin-bottom:16px">
            <div class="flex gap-8" style="align-items:center">
              <span style="font-size:20px">⚠️</span>
              <div>
                <div style="font-weight:700">Falta ${missingDocs.length > 1 ? missingDocs.slice(0, -1).join(", ") + " y " + missingDocs[missingDocs.length - 1] : missingDocs[0]} de este cliente</div>
                <div class="text-sm text-muted">Esta carta necesita esa(s) copia(s) adjunta(s). <a href="#/clientes/${letter.client_id}">Súbela(s) en la ficha del cliente</a> antes de imprimir/enviar.</div>
              </div>
            </div>
          </div>`
        : ""
    }
    ${
      needsIdCopy || needsAddressProof
        ? `<div class="card no-print" style="margin-bottom:16px">
            <div class="text-sm"><strong>📎 Adjuntos automáticos:</strong> ${[needsIdCopy ? "copia de ID" : "", needsAddressProof ? "comprobante de domicilio" : ""].filter(Boolean).join(" + ")}${missingDocs.length ? "" : " — se agregarán al imprimir esta carta."}</div>
          </div>`
        : ""
    }

    <div class="grid grid-2">
      <div class="card">
        <div class="flex-between" style="margin-bottom:12px">
          <h3 style="font-size:15px">${escapeHtml(letter.title)}</h3>
          ${statusBadge(letter.status)}
        </div>
        <textarea id="letter-body" style="min-height:380px">${escapeHtml(letter.body)}</textarea>
        <div class="form-actions no-print">
          <button class="btn btn-ghost btn-sm" id="save-body-btn">Guardar cambios</button>
        </div>
        <div class="letter-preview" id="letter-preview" style="margin-top:16px">${escapeHtml(letter.body)}</div>
        ${needsIdCopy && docIdFile ? `<div class="print-only"><img src="/api/clients/${letter.client_id}/documents/${docIdFile.id}/file" style="max-width:100%" alt="Copia de identificación" /></div>` : ""}
        ${needsAddressProof && docAddressFile ? `<div class="print-only"><img src="/api/clients/${letter.client_id}/documents/${docAddressFile.id}/file" style="max-width:100%" alt="Comprobante de domicilio" /></div>` : ""}
        ${needsSsnCopy && docSsnFile ? `<div class="print-only"><img src="/api/clients/${letter.client_id}/documents/${docSsnFile.id}/file" style="max-width:100%" alt="Copia de Social Security" /></div>` : ""}
      </div>

      <div class="flex" style="flex-direction:column;gap:18px">
        <div class="card no-print" id="action-card"></div>
        <div class="card no-print">
          <h3 style="font-size:15px;margin-bottom:12px">Actividad</h3>
          <div class="timeline" id="letter-activity" style="max-height:340px;overflow-y:auto"></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("letter-activity").innerHTML = activity.length
    ? activity
        .map(
          (a) => `<div class="timeline-item"><div class="timeline-body"><div class="t-action">${ACTION_LABELS[a.action] || a.action}</div>${a.detail ? `<div class="t-detail">${escapeHtml(a.detail)}</div>` : ""}<div class="t-time">${formatDateTime(a.created_at)}</div></div></div>`
        )
        .join("")
    : `<div class="empty text-sm">Sin actividad todavía.</div>`;

  const bodyArea = document.getElementById("letter-body");
  const preview = document.getElementById("letter-preview");
  bodyArea.addEventListener("input", () => (preview.textContent = bodyArea.value));

  document.getElementById("print-btn").addEventListener("click", () => window.print());
  document.getElementById("save-body-btn").addEventListener("click", async () => {
    try {
      await api.put(`/letters/${id}`, {
        title: letter.title,
        recipient_name: letter.recipient_name,
        recipient_address: letter.recipient_address,
        round_number: letter.round_number,
        body: bodyArea.value,
        notes: letter.notes,
      });
      toast("Cambios guardados", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  document.getElementById("delete-btn").addEventListener("click", async () => {
    const ok = await confirmDialog("¿Eliminar esta carta? Esta acción no se puede deshacer.");
    if (!ok) return;
    try {
      await api.del(`/letters/${id}`);
      toast("Carta eliminada", "success");
      window.__creditflowNavigate("#/cartas");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  renderActionCard(letter, mailing, id, container);
}

function renderActionCard(letter, mailing, id, container) {
  const box = document.getElementById("action-card");

  async function setStatus(status) {
    try {
      await api.post(`/letters/${id}/status`, { status });
      toast("Estado actualizado", "success");
      renderLetterDetail(container, id);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  if (letter.status === "borrador") {
    box.innerHTML = `
      <h3 style="font-size:15px;margin-bottom:10px">Siguiente paso</h3>
      <p class="text-sm text-muted" style="margin-bottom:14px">Cuando el contenido esté listo, márcala como "lista para enviar" para pasarla a la sección de envíos certificados.</p>
      <button class="btn btn-primary btn-block" id="mark-ready">${icon("check")} Marcar como lista para enviar</button>
    `;
    box.querySelector("#mark-ready").addEventListener("click", () => setStatus("lista"));
    return;
  }

  if (letter.status === "lista") {
    box.innerHTML = `
      <h3 style="font-size:15px;margin-bottom:10px">Enviar por correo certificado</h3>
      <p class="text-sm text-muted" style="margin-bottom:14px">1. Abre certifiedmaillabels.com, crea y paga la etiqueta con los datos del destinatario. 2. Copia el número de rastreo y pégalo aquí.</p>
      <a class="btn btn-ghost btn-block" href="${CERTIFIED_MAIL_URL}" target="_blank" rel="noopener" style="margin-bottom:14px">${icon("link")} Abrir certifiedmaillabels.com</a>
      <form id="send-form">
        <div class="field" style="margin-bottom:10px"><label>Número de rastreo (USPS) *</label><input type="text" name="tracking_number" required placeholder="Ej. 9407 3000 0000 0000 0000 00" /></div>
        <div class="field" style="margin-bottom:10px"><label>Costo (opcional)</label><input type="text" name="cost" placeholder="$7.28" /></div>
        <button class="btn btn-primary btn-block" type="submit">${icon("send")} Registrar envío</button>
      </form>
    `;
    box.querySelector("#send-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.post(`/letters/${id}/send`, {
          tracking_number: fd.get("tracking_number"),
          cost: fd.get("cost"),
        });
        toast("Envío registrado", "success");
        renderLetterDetail(container, id);
      } catch (err) {
        toast(err.message, "error");
      }
    });
    return;
  }

  if (["enviada", "en_transito", "entregada", "devuelta"].includes(letter.status) && mailing) {
    box.innerHTML = `
      <h3 style="font-size:15px;margin-bottom:10px">Envío certificado</h3>
      <div class="text-sm" style="margin-bottom:6px"><span class="text-muted">Rastreo:</span> ${escapeHtml(mailing.tracking_number)}</div>
      <div class="text-sm" style="margin-bottom:6px"><span class="text-muted">Transportista:</span> ${escapeHtml(mailing.carrier)}</div>
      <div class="text-sm" style="margin-bottom:14px"><span class="text-muted">Último estado:</span> ${escapeHtml(mailing.last_status) || "—"}</div>
      <button class="btn btn-ghost btn-block" id="refresh-tracking" style="margin-bottom:10px">${icon("refresh")} Actualizar rastreo (USPS)</button>
      <div class="tag-row">
        <button class="pill-filter" data-s="en_transito">En tránsito</button>
        <button class="pill-filter" data-s="entregada">Entregada</button>
        <button class="pill-filter" data-s="devuelta">Devuelta</button>
      </div>
      ${letter.status === "entregada" ? `<button class="btn btn-primary btn-block" id="mark-complete" style="margin-top:14px">${icon("check")} Marcar como completada</button>` : ""}
    `;
    box.querySelector("#refresh-tracking").addEventListener("click", async () => {
      try {
        await api.post(`/mailings/${mailing.id}/refresh`);
        toast("Rastreo actualizado", "success");
        renderLetterDetail(container, id);
      } catch (err) {
        toast(err.message, "error");
      }
    });
    box.querySelectorAll("[data-s]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api.put(`/mailings/${mailing.id}`, { status_key: b.dataset.s });
          toast("Estado actualizado", "success");
          renderLetterDetail(container, id);
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
    const completeBtn = box.querySelector("#mark-complete");
    if (completeBtn) completeBtn.addEventListener("click", () => setStatus("completada"));
    return;
  }

  box.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:10px">Estado</h3>
    <p class="text-sm text-muted" style="margin-bottom:14px">Esta carta está marcada como <strong>${STATUS_META[letter.status]?.label || letter.status}</strong>.</p>
    <div class="tag-row">
      ${LETTER_STATUS_FLOW.concat(["devuelta", "respondida"])
        .filter((s) => s !== letter.status)
        .map((s) => `<button class="pill-filter" data-s="${s}">${STATUS_META[s].label}</button>`)
        .join("")}
    </div>
  `;
  box.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.s)));
}
