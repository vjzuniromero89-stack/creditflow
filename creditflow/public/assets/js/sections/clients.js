import { api } from "../api.js";
import { icon } from "../icons.js";
import { openModal, confirmDialog } from "../modal.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDate, formatDateTime, initials, statusBadge, debounce } from "../utils.js";
import { ACTION_LABELS } from "./dashboard.js";
import { renderClientCreditItems, openCreditItemModal, runSmartGenerateForClient } from "./collections.js";
import { roundLabel, formatDobForLetter } from "./letters.js";
import { renderClientDocuments } from "./documents.js";
import { renderClientCreditScore } from "./creditscore.js";
import { renderClientAddresses } from "./addresses.js";

const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

// Muestra el usuario/contraseña del portal UNA sola vez (justo al crearse o al regenerarse) —
// después ya no se puede volver a leer la contraseña, solo queda su hash. Se usa tanto al crear
// un cliente nuevo como al regenerar el acceso desde su ficha.
function showPortalPasswordReveal(box, username, password) {
  box.innerHTML = `
    <div class="card" style="border-color:var(--amber);padding:12px">
      <div class="text-sm" style="margin-bottom:8px"><strong>⚠️ Guarda esta contraseña ahora</strong> — por seguridad no se puede volver a mostrar. Compártela con tu cliente para que entre a su portal.</div>
      <div class="flex gap-8" style="align-items:center;flex-wrap:wrap">
        <code style="background:rgba(255,255,255,.06);padding:5px 10px;border-radius:6px;font-size:13px">${escapeHtml(username)}</code>
        <code style="background:rgba(255,255,255,.06);padding:5px 10px;border-radius:6px;font-size:13px">${escapeHtml(password)}</code>
        <button class="btn btn-ghost btn-sm" type="button" id="copy-portal-creds">${icon("copy")} Copiar</button>
      </div>
    </div>
  `;
  box.querySelector("#copy-portal-creds").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`Usuario: ${username}\nContraseña: ${password}`);
      toast("Copiado al portapapeles", "success");
    } catch {
      toast("No se pudo copiar — cópialo manualmente", "error");
    }
  });
}

function clientFormHtml(c = {}) {
  return `
    <form id="client-form">
      ${
        !c.id
          ? `
      <div class="field" style="grid-column:1/-1;margin-bottom:16px;padding:12px;border:1px dashed var(--border);border-radius:10px">
        <label>Subir foto de ID / licencia (opcional)</label>
        <p class="text-sm text-muted" style="margin:2px 0 8px">La IA lee el nombre, dirección, fecha de nacimiento, etc. de la foto y llena el formulario de abajo — revísalo antes de guardar. La foto también queda guardada en Documentos del cliente.</p>
        <input type="file" id="id-photo-input" accept="image/jpeg,image/png,image/webp" />
        <div id="id-photo-status" class="text-sm text-muted" style="margin-top:6px"></div>
      </div>
      `
          : ""
      }
      <div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Nombre completo *</label><input type="text" name="full_name" required value="${escapeHtml(c.full_name)}" /></div>
        <div class="field"><label>Email</label><input type="email" name="email" value="${escapeHtml(c.email)}" /></div>
        <div class="field"><label>Teléfono</label><input type="text" name="phone" value="${escapeHtml(c.phone)}" /></div>
        <div class="field" style="grid-column:1/-1"><label>Dirección</label><input type="text" name="address" value="${escapeHtml(c.address)}" /></div>
        <div class="field"><label>Ciudad</label><input type="text" name="city" value="${escapeHtml(c.city)}" /></div>
        <div class="field">
          <label>Estado</label>
          <select name="state">
            <option value="">—</option>
            ${US_STATES.map((s) => `<option value="${s}" ${c.state === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Código postal</label><input type="text" name="zip" value="${escapeHtml(c.zip)}" /></div>
        <div class="field"><label>Últimos 4 del ID/SSN</label><input type="text" name="id_last4" maxlength="4" value="${escapeHtml(c.id_last4)}" /></div>
        <div class="field"><label>Fecha de nacimiento</label><input type="date" name="date_of_birth" value="${c.date_of_birth ? c.date_of_birth.slice(0, 10) : ""}" /></div>
        <div class="field">
          <label>SSN completo${c.has_ssn_full ? " (ya guardado)" : ""}</label>
          <input type="text" name="ssn_full" maxlength="11" placeholder="${c.has_ssn_full ? "•••-••-•••• (déjalo vacío para no cambiarlo)" : "Ej. 123-45-6789"}" />
          <span class="text-sm text-muted">Se guarda cifrado — solo hace falta para tramitar el freeze de identidad en las agencias secundarias.</span>
        </div>
        <div class="field">
          <label>Estado del cliente</label>
          <select name="status">
            <option value="activo" ${c.status === "activo" || !c.status ? "selected" : ""}>Activo</option>
            <option value="pausado" ${c.status === "pausado" ? "selected" : ""}>Pausado</option>
            <option value="completado" ${c.status === "completado" ? "selected" : ""}>Completado</option>
          </select>
        </div>
        <div class="field" style="grid-column:1/-1"><label>Notas</label><textarea name="notes" style="min-height:70px;font-family:inherit">${escapeHtml(c.notes)}</textarea></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${c.id ? "Guardar cambios" : "Crear cliente"}</button>
      </div>
    </form>
  `;
}

function openClientModal(existing, onSaved) {
  const { overlay, close, body } = openModal({
    title: existing ? "Editar cliente" : "Nuevo cliente",
    bodyHtml: clientFormHtml(existing || {}),
    wide: true,
  });
  body.querySelector("[data-close]").addEventListener("click", close);

  let pendingIdPhoto = null;
  const idPhotoInput = body.querySelector("#id-photo-input");
  if (idPhotoInput) {
    idPhotoInput.addEventListener("change", async () => {
      const file = idPhotoInput.files[0];
      if (!file) return;
      pendingIdPhoto = file;
      const statusEl = body.querySelector("#id-photo-status");
      const form = body.querySelector("#client-form");
      statusEl.textContent = "Leyendo con IA…";
      try {
        const fd = new FormData();
        fd.append("file", file);
        const { fields } = await api.upload("/clients/extract-id", fd);
        const set = (name, value) => {
          if (!value) return;
          const el = form.querySelector(`[name="${name}"]`);
          if (el) el.value = value;
        };
        set("full_name", fields.full_name);
        set("address", fields.address);
        set("city", fields.city);
        set("state", fields.state);
        set("zip", fields.zip);
        set("date_of_birth", fields.date_of_birth);
        set("id_last4", fields.id_last4);
        statusEl.textContent = "Datos leídos — revisa los campos antes de guardar.";
        toast("Datos leídos del ID — revísalos antes de guardar", "success");
      } catch (err) {
        statusEl.textContent = "";
        toast(err.message, "error");
      }
    });
  }

  body.querySelector("#client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      let clientId = existing ? existing.id : null;
      let portalCreds = null;
      if (existing) {
        await api.put(`/clients/${existing.id}`, payload);
        toast("Cliente actualizado", "success");
      } else {
        const { client, portal_username, portal_password_plain } = await api.post("/clients", payload);
        clientId = client.id;
        portalCreds = { username: portal_username, password: portal_password_plain };
        toast("Cliente creado", "success");
      }
      if (pendingIdPhoto && clientId) {
        try {
          const docFd = new FormData();
          docFd.append("doc_type", "id");
          docFd.append("file", pendingIdPhoto);
          await api.upload(`/clients/${clientId}/documents`, docFd);
        } catch (err) {
          toast("Cliente guardado, pero no se pudo guardar la foto del ID en Documentos — puedes subirla desde su ficha.", "error");
        }
      }
      close();
      onSaved();
      if (portalCreds) {
        const { body: revealBody } = openModal({ title: "Acceso al portal del cliente creado", bodyHtml: "" });
        showPortalPasswordReveal(revealBody, portalCreds.username, portalCreds.password);
      }
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

export async function renderClientsList(container) {
  container.innerHTML = `
    <div class="section-head">
      <div>
        <div class="tag-row" id="status-filters">
          <button class="pill-filter active" data-status="">Todos</button>
          <button class="pill-filter" data-status="activo">Activos</button>
          <button class="pill-filter" data-status="pausado">Pausados</button>
          <button class="pill-filter" data-status="completado">Completados</button>
        </div>
      </div>
      <div class="flex gap-12">
        <div class="search-box">${icon("search")}<input type="search" id="client-search" placeholder="Buscar cliente..." /></div>
        <button class="btn btn-ghost" id="portal-backfill-btn" title="Genera usuario y contraseña de portal para clientes creados antes de esta función">${icon("refresh")} Generar accesos de portal faltantes</button>
        <button class="btn btn-primary" id="new-client-btn">${icon("plus")} Nuevo cliente</button>
      </div>
    </div>
    <div class="table-wrap"><div id="clients-table"></div></div>
  `;

  document.getElementById("portal-backfill-btn").addEventListener("click", async () => {
    const btn = document.getElementById("portal-backfill-btn");
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = "Generando…";
    try {
      const { created } = await api.post("/clients/portal/backfill", {});
      if (!created.length) {
        toast("Todos tus clientes ya tienen acceso al portal", "success");
      } else {
        const { body } = openModal({ title: `Accesos de portal generados (${created.length})`, bodyHtml: "", wide: true });
        body.innerHTML = `
          <p class="text-sm text-muted" style="margin-bottom:12px">⚠️ Guarda esta lista ahora — las contraseñas no se pueden volver a mostrar. Compártele a cada cliente su usuario y contraseña.</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Cliente</th><th>Usuario</th><th>Contraseña</th></tr></thead>
              <tbody>
                ${created
                  .map((c) => `<tr><td class="row-name">${escapeHtml(c.client_name)}</td><td><code>${escapeHtml(c.portal_username)}</code></td><td><code>${escapeHtml(c.portal_password_plain)}</code></td></tr>`)
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
        toast(`${created.length} acceso(s) de portal generado(s)`, "success");
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  let currentStatus = "";
  let currentQ = "";

  async function load() {
    const params = new URLSearchParams();
    if (currentStatus) params.set("status", currentStatus);
    if (currentQ) params.set("q", currentQ);
    const { clients } = await api.get(`/clients?${params.toString()}`);
    renderTable(clients);
  }

  function renderTable(clients) {
    const box = document.getElementById("clients-table");
    if (!clients.length) {
      box.innerHTML = `<div class="empty"><div class="mark">🗂️</div><h3>Sin clientes todavía</h3><p>Agrega tu primer cliente para empezar a generar cartas.</p></div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Cliente</th><th>Contacto</th><th>Estado</th><th>Cartas</th><th>Alta</th><th></th></tr></thead>
        <tbody>
          ${clients
            .map(
              (c) => `
            <tr data-id="${c.id}">
              <td><div class="flex gap-12" style="align-items:center"><div class="user-avatar" style="width:30px;height:30px;font-size:11px">${initials(c.full_name)}</div><span class="row-name">${escapeHtml(c.full_name)}</span></div></td>
              <td><div>${escapeHtml(c.email) || "—"}</div><div class="row-sub">${escapeHtml(c.phone) || ""}</div></td>
              <td><span class="badge badge-${c.status}">${c.status}</span></td>
              <td>${c.letters_count} <span class="row-sub">(${c.letters_active} activas)</span></td>
              <td class="row-sub">${formatDate(c.created_at)}</td>
              <td class="cell-actions">
                <button class="btn btn-ghost btn-sm btn-icon" data-edit="${c.id}">${icon("edit")}</button>
                <button class="btn btn-danger btn-sm btn-icon" data-del="${c.id}">${icon("trash")}</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    box.querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        window.__creditflowNavigate(`#/clientes/${tr.dataset.id}`);
      })
    );
    box.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const { client } = await api.get(`/clients/${b.dataset.edit}`);
        openClientModal(client, load);
      })
    );
    box.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog("¿Eliminar este cliente? También se eliminarán sus cartas asociadas.");
        if (!ok) return;
        try {
          await api.del(`/clients/${b.dataset.del}`);
          toast("Cliente eliminado", "success");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  document.getElementById("new-client-btn").addEventListener("click", () => openClientModal(null, load));
  document.getElementById("client-search").addEventListener(
    "input",
    debounce((e) => {
      currentQ = e.target.value;
      load();
    }, 300)
  );
  document.querySelectorAll("#status-filters .pill-filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#status-filters .pill-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatus = btn.dataset.status;
      load();
    })
  );

  await load();
}

async function renderClientLetters(container, clientId, initialLetters) {
  let letters = initialLetters;

  async function reload() {
    const fresh = await api.get(`/clients/${clientId}`);
    letters = fresh.letters;
    draw();
  }

  function selectedIds(box) {
    return Array.from(box.querySelectorAll(".letter-check:checked")).map((c) => c.dataset.id);
  }

  function draw() {
    if (!letters.length) {
      container.innerHTML = `<div class="empty"><div class="mark">✉️</div><h3>Sin cartas todavía</h3><p>Crea la primera carta para este cliente.</p></div>`;
      return;
    }

    const draftCount = letters.filter((l) => l.status === "borrador").length;

    container.innerHTML = `
      <div class="flex-between" style="margin-bottom:10px">
        <label class="flex gap-8" style="align-items:center;font-size:13px" for="letters-select-all">
          <input type="checkbox" id="letters-select-all" /> Seleccionar todo
        </label>
        <div class="flex gap-8">
          ${draftCount ? `<button class="btn btn-primary btn-sm" id="mark-ready-all-btn">${icon("send")} Enviar todas las borrador a envíos certificados (${draftCount})</button>` : ""}
          <button class="btn btn-ghost btn-sm" id="mark-ready-selected-btn" disabled>${icon("send")} Marcar seleccionadas como listas para enviar</button>
          <button class="btn btn-danger btn-sm" id="delete-selected-btn" disabled>${icon("trash")} Eliminar seleccionadas</button>
          <button class="btn btn-ghost btn-sm" id="delete-all-btn">${icon("trash")} Eliminar todas</button>
        </div>
      </div>
      <p class="text-sm text-muted" style="margin:-4px 0 10px">Las cartas se generan como <strong>borrador</strong> — cuando estén listas, márcalas aquí (o una por una desde la carta) para que aparezcan en <a href="#/envios">Envíos certificados</a>.</p>
      <table>
        <thead><tr><th style="width:36px"></th><th>Carta</th><th>Plantilla</th><th>Ronda</th><th>Estado</th><th>Actualizada</th></tr></thead>
        <tbody>
          ${letters
            .map(
              (l) => `
            <tr data-id="${l.id}">
              <td class="cell-check"><input type="checkbox" class="letter-check" data-id="${l.id}" /></td>
              <td class="row-name">${escapeHtml(l.title)}</td>
              <td class="row-sub">${escapeHtml(l.template_name) || "—"}</td>
              <td>${roundLabel(l.round_number)}</td>
              <td>${statusBadge(l.status)}</td>
              <td class="row-sub">${formatDate(l.updated_at)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    const deleteSelectedBtn = container.querySelector("#delete-selected-btn");
    const markReadySelectedBtn = container.querySelector("#mark-ready-selected-btn");
    const selectAll = container.querySelector("#letters-select-all");

    function updateDeleteSelectedState() {
      const n = selectedIds(container).length;
      deleteSelectedBtn.disabled = n === 0;
      deleteSelectedBtn.innerHTML = n > 0 ? `${icon("trash")} Eliminar seleccionadas (${n})` : `${icon("trash")} Eliminar seleccionadas`;
      markReadySelectedBtn.disabled = n === 0;
      markReadySelectedBtn.innerHTML = n > 0 ? `${icon("send")} Marcar seleccionadas como listas para enviar (${n})` : `${icon("send")} Marcar seleccionadas como listas para enviar`;
    }

    container.querySelectorAll(".letter-check").forEach((cb) =>
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        updateDeleteSelectedState();
        selectAll.checked = selectedIds(container).length === letters.length;
      })
    );

    selectAll.addEventListener("click", () => {
      container.querySelectorAll(".letter-check").forEach((cb) => (cb.checked = selectAll.checked));
      updateDeleteSelectedState();
    });

    container.querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("input")) return;
        window.__creditflowNavigate(`#/cartas/${tr.dataset.id}`);
      })
    );

    async function deleteLetters(ids) {
      let failed = 0;
      for (const letterId of ids) {
        try {
          await api.del(`/letters/${letterId}`);
        } catch {
          failed++;
        }
      }
      toast(failed ? `${ids.length - failed} carta(s) eliminada(s), ${failed} fallaron` : `${ids.length} carta(s) eliminada(s)`, failed ? "error" : "success");
      await reload();
    }

    // Solo tiene sentido "marcar como lista para enviar" a las que siguen en borrador — una carta
    // ya enviada/entregada no se debe regresar a "lista" por accidente si queda seleccionada.
    async function markLettersReady(ids) {
      const eligible = ids.filter((id) => {
        const l = letters.find((x) => String(x.id) === String(id));
        return l && l.status === "borrador";
      });
      const skipped = ids.length - eligible.length;
      let failed = 0;
      for (const letterId of eligible) {
        try {
          await api.post(`/letters/${letterId}/status`, { status: "lista" });
        } catch {
          failed++;
        }
      }
      const okCount = eligible.length - failed;
      if (okCount > 0) {
        toast(`${okCount} carta(s) lista(s) para enviar — ya aparecen en Envíos certificados`, "success");
      }
      if (failed) toast(`${failed} carta(s) no se pudieron actualizar`, "error");
      if (skipped) toast(`${skipped} carta(s) omitida(s) por no estar en borrador`, "error");
      if (!okCount && !failed && !skipped) toast("No había cartas para marcar", "error");
      await reload();
    }

    deleteSelectedBtn.addEventListener("click", async () => {
      const ids = selectedIds(container);
      if (!ids.length) return;
      const ok = await confirmDialog(`¿Eliminar ${ids.length} carta(s) seleccionada(s)? Esta acción no se puede deshacer.`);
      if (!ok) return;
      await deleteLetters(ids);
    });

    markReadySelectedBtn.addEventListener("click", async () => {
      const ids = selectedIds(container);
      if (!ids.length) return;
      await markLettersReady(ids);
    });

    const markReadyAllBtn = container.querySelector("#mark-ready-all-btn");
    if (markReadyAllBtn) {
      markReadyAllBtn.addEventListener("click", async () => {
        const draftIds = letters.filter((l) => l.status === "borrador").map((l) => String(l.id));
        await markLettersReady(draftIds);
      });
    }

    container.querySelector("#delete-all-btn").addEventListener("click", async () => {
      const ok = await confirmDialog(`¿Eliminar las ${letters.length} carta(s) de este cliente? Esta acción no se puede deshacer.`);
      if (!ok) return;
      await deleteLetters(letters.map((l) => String(l.id)));
    });
  }

  draw();
}

/* ------------------------------------------------------------------ */
/* Congelamiento de identidad (Freeze) — agencias secundarias           */
/* ------------------------------------------------------------------ */
const FREEZE_STATUS_LABEL = {
  no_iniciado: "No iniciado",
  solicitado: "Solicitado",
  congelado: "Congelado",
  requiere_llamada: "Requiere llamada",
  no_disponible: "No disponible",
};

// Catálogo de agencias secundarias de verificación de identidad/reporte alterno — las que más se
// usan en la práctica de reparación de crédito. Todas piden el SSN completo del cliente para
// procesar el freeze (algunas también exigen crear una cuenta), así que el envío es manual.
// Nombres/teléfonos/links pueden cambiar — la CFPB publica una lista oficial actualizada cada año.
const FREEZE_AGENCIES = [
  { key: "lexisnexis", label: "LexisNexis (incluye SageStream)", url: "https://consumer.risk.lexisnexis.com/freeze", phone: "1-800-456-1244" },
  { key: "innovis", label: "Innovis", url: "https://www.innovis.com/personal/securityFreeze", phone: "1-800-540-2505" },
  { key: "chexsystems", label: "ChexSystems", url: "https://www.chexsystems.com/security-freeze/place-freeze", phone: "1-800-428-9623" },
  { key: "nctue", label: "NCTUE", url: "https://www.nctue.com/consumers", phone: "1-866-349-5355" },
  { key: "teletrack", label: "CoreLogic / Teletrack", url: "https://consumers.teletrack.com/freeze", phone: "" },
  { key: "telecheck", label: "TeleCheck", url: "https://getassistance.telecheck.com", phone: "" },
  { key: "ews", label: "Early Warning Services (EWS)", url: "", phone: "1-800-745-1560" },
];

async function renderClientFreezeSection(quickcopyBox, rowsBox, clientId, client) {
  quickcopyBox.innerHTML = `<div class="text-sm text-muted">Cargando…</div>`;
  rowsBox.innerHTML = "";

  quickcopyBox.innerHTML = `
    <div class="card" style="padding:12px">
      <div class="text-sm text-muted" style="margin-bottom:6px">Ficha rápida para copiar en cada sitio de freeze:</div>
      <div class="text-sm" style="line-height:1.7">
        <div><strong>Nombre:</strong> ${escapeHtml(client.full_name)}</div>
        <div><strong>Fecha de nacimiento:</strong> ${formatDobForLetter(client.date_of_birth) || "—"}</div>
        <div><strong>Dirección:</strong> ${escapeHtml(client.address) || "—"} ${escapeHtml(client.city) || ""} ${escapeHtml(client.state) || ""} ${escapeHtml(client.zip) || ""}</div>
        <div><strong>Teléfono:</strong> ${escapeHtml(client.phone) || "—"}</div>
        <div><strong>SSN:</strong> ${client.has_ssn_full ? `<span id="freeze-ssn-value">•••-••-••••</span> <button type="button" class="btn btn-ghost btn-sm" id="freeze-ssn-reveal" style="padding:1px 6px">Ver</button>` : "— no guardado —"}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="freeze-copy-all" style="margin-top:8px">${icon("copy")} Copiar todo</button>
    </div>
  `;

  let revealedSsn = "";
  const ssnRevealBtn = quickcopyBox.querySelector("#freeze-ssn-reveal");
  if (ssnRevealBtn) {
    ssnRevealBtn.addEventListener("click", async () => {
      try {
        const { ssn_full } = await api.post(`/clients/${clientId}/ssn/reveal`, {});
        revealedSsn = ssn_full;
        quickcopyBox.querySelector("#freeze-ssn-value").textContent = ssn_full;
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }
  quickcopyBox.querySelector("#freeze-copy-all").addEventListener("click", async () => {
    const lines = [
      `Nombre: ${client.full_name || ""}`,
      `Fecha de nacimiento: ${formatDobForLetter(client.date_of_birth) || ""}`,
      `Dirección: ${[client.address, client.city, client.state, client.zip].filter(Boolean).join(", ")}`,
      `Teléfono: ${client.phone || ""}`,
      `SSN: ${revealedSsn || "(no revelado — dale click a Ver primero)"}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("Copiado al portapapeles", "success");
    } catch {
      toast("No se pudo copiar — cópialo manualmente", "error");
    }
  });

  const { freezes } = await api.get(`/clients/${clientId}/freezes`);
  const byAgency = Object.fromEntries((freezes || []).map((f) => [f.agency, f]));

  rowsBox.innerHTML = FREEZE_AGENCIES.map((a) => {
    const f = byAgency[a.key] || {};
    const status = f.status || "no_iniciado";
    return `
      <tr data-agency="${a.key}">
        <td class="row-name">
          ${escapeHtml(a.label)}<br/>
          <span class="text-sm text-muted">
            ${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">Ir al sitio ↗</a>` : ""}
            ${a.url && a.phone ? " · " : ""}
            ${a.phone ? escapeHtml(a.phone) : ""}
          </span>
        </td>
        <td>
          <select data-field="status" style="font-size:13px">
            ${Object.entries(FREEZE_STATUS_LABEL).map(([k, label]) => `<option value="${k}" ${status === k ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </td>
        <td><input type="date" data-field="requested_at" value="${f.requested_at ? String(f.requested_at).slice(0, 10) : ""}" style="font-size:13px" /></td>
        <td><input type="text" data-field="confirmation_code" value="${escapeHtml(f.confirmation_code)}" placeholder="—" style="font-size:13px;width:110px" /></td>
        <td><input type="text" data-field="notes" value="${escapeHtml(f.notes)}" placeholder="—" style="font-size:13px" /></td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-save style="padding:2px 8px">Guardar</button></td>
      </tr>`;
  }).join("");

  rowsBox.querySelectorAll("tr[data-agency]").forEach((row) => {
    row.querySelector("[data-save]").addEventListener("click", async () => {
      const agency = row.dataset.agency;
      const payload = {
        status: row.querySelector('[data-field="status"]').value,
        requested_at: row.querySelector('[data-field="requested_at"]').value || null,
        confirmation_code: row.querySelector('[data-field="confirmation_code"]').value || null,
        notes: row.querySelector('[data-field="notes"]').value || null,
      };
      try {
        await api.put(`/clients/${clientId}/freezes/${agency}`, payload);
        toast("Freeze actualizado", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

export async function renderClientDetail(container, id) {
  container.innerHTML = `<div class="card">Cargando...</div>`;
  const { client, letters, activity } = await api.get(`/clients/${id}`);

  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="flex-between" style="margin-bottom:16px">
          <div class="flex gap-12" style="align-items:center">
            <div class="user-avatar" style="width:46px;height:46px;font-size:15px">${initials(client.full_name)}</div>
            <div>
              <h2 style="font-size:18px">${escapeHtml(client.full_name)}</h2>
              <span class="badge badge-${client.status}">${client.status}</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" id="edit-client">${icon("edit")} Editar</button>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
          <div><div class="text-muted text-sm">Email</div>${escapeHtml(client.email) || "—"}</div>
          <div><div class="text-muted text-sm">Teléfono</div>${escapeHtml(client.phone) || "—"}</div>
          <div style="grid-column:1/-1"><div class="text-muted text-sm">Dirección</div>${escapeHtml(client.address) || "—"} ${escapeHtml(client.city) || ""} ${escapeHtml(client.state) || ""} ${escapeHtml(client.zip) || ""}</div>
          <div><div class="text-muted text-sm">ID/SSN (últ. 4)</div>${escapeHtml(client.id_last4) || "—"}</div>
          <div><div class="text-muted text-sm">Fecha de nacimiento</div>${formatDobForLetter(client.date_of_birth) || "—"}</div>
          <div>
            <div class="text-muted text-sm">SSN completo</div>
            ${
              client.has_ssn_full
                ? `<span id="ssn-full-value">•••-••-••••</span> <button type="button" class="btn btn-ghost btn-sm" id="ssn-reveal-btn" style="padding:1px 6px">Ver</button>`
                : "—"
            }
          </div>
          <div><div class="text-muted text-sm">Cliente desde</div>${formatDate(client.created_at)}</div>
        </div>
        ${client.notes ? `<div style="margin-top:14px"><div class="text-muted text-sm">Notas</div>${escapeHtml(client.notes)}</div>` : ""}
      </div>
      <div class="card">
        <h3 style="font-size:15px;margin-bottom:14px">Actividad</h3>
        <div class="timeline" id="client-activity"></div>
      </div>
    </div>

    <div class="card" style="margin-top:24px">
      <div class="flex-between" style="margin-bottom:10px;flex-wrap:wrap;gap:10px">
        <h3 style="font-size:15px">🔑 Acceso al portal del cliente</h3>
        <button class="btn btn-ghost btn-sm" id="portal-reset-btn">${icon("refresh")} ${client.portal_username ? "Regenerar contraseña" : "Generar acceso"}</button>
      </div>
      <p class="text-sm text-muted" style="margin-bottom:10px">Tu cliente entra en <strong>#/portal</strong> de esta misma app con este usuario para ver cómo va su proceso — nunca ve tarifas ni precios, eso es solo tuyo.</p>
      <div class="text-sm">Usuario: <strong id="portal-username-value">${client.portal_username ? escapeHtml(client.portal_username) : "— todavía no tiene —"}</strong></div>
      <div id="portal-password-reveal" style="margin-top:10px"></div>
    </div>

    <div class="card" style="margin-top:24px">
      <h3 style="font-size:15px;margin-bottom:6px">🧊 Congelamiento de identidad (Freeze)</h3>
      <p class="text-sm text-muted" style="margin-bottom:14px">Congelar el reporte de este cliente en las agencias secundarias les dificulta a los burós y acreedores verificar su identidad — ayuda a que las disputas prosperen. Varias de estas agencias piden el SSN completo y varias exigen crear una cuenta, así que el envío en cada sitio lo hacen tú o Victor a mano; aquí solo llevas el control de cuáles ya están congeladas.</p>
      <div id="freeze-quickcopy" style="margin-bottom:16px"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Agencia</th><th>Estatus</th><th>Fecha</th><th>Confirmación / PIN</th><th>Notas</th><th></th></tr></thead>
          <tbody id="freeze-rows"></tbody>
        </table>
      </div>
    </div>

    <div class="section-head" style="margin-top:24px">
      <h2>Credit score</h2>
    </div>
    <div id="client-credit-score"></div>

    <div class="section-head" style="margin-top:24px">
      <div>
        <h2>Documentos del cliente</h2>
        <p class="text-sm text-muted" style="margin-top:2px">ID, comprobante de domicilio y Social Security — se incluyen automáticamente en las cartas que los requieran.</p>
      </div>
    </div>
    <div id="client-documents"></div>

    <div class="section-head" style="margin-top:24px">
      <div>
        <h2>Colecciones de este cliente</h2>
        <p class="text-sm text-muted" style="margin-top:2px">Ítems negativos detectados en su reporte de crédito (colecciones, charge-offs, pagos tardíos, inquiries).</p>
      </div>
      <div class="flex gap-12">
        <input type="file" id="import-report-input" accept=".pdf" style="display:none" />
        <button class="btn btn-ghost" id="import-report-btn">${icon("upload")} Importar reporte de crédito</button>
        <button class="btn btn-ghost" id="add-item-btn">${icon("plus")} Agregar ítem</button>
        <button class="btn btn-primary" id="bulk-gen-btn">${icon("spark")} Generar cartas (estrategia automática)</button>
      </div>
    </div>
    <p class="text-sm text-muted" style="margin-top:-8px">Detecta en cuántos burós reporta cada ítem y genera las cartas que le tocan según el proceso: primero limpieza de información personal, luego Ronda 1, 2 y 3 — siempre como borrador para que tú confirmes el envío. Al importar también se actualiza el historial de direcciones de abajo y se detecta solo si algún ítem ya se borró del reporte.</p>
    <div id="client-earnings"></div>
    <div id="client-credit-items"></div>

    <div class="section-head" style="margin-top:24px">
      <div>
        <h2>Direcciones del cliente</h2>
        <p class="text-sm text-muted" style="margin-top:2px">Historial completo de direcciones reportadas — se actualiza solo al importar un reporte de crédito.</p>
      </div>
    </div>
    <div id="client-addresses"></div>

    <div class="section-head" style="margin-top:24px">
      <h2>Cartas de este cliente</h2>
      <button class="btn btn-primary" id="new-letter-btn">${icon("plus")} Nueva carta</button>
    </div>
    <div class="table-wrap"><div id="client-letters"></div></div>
  `;

  document.getElementById("portal-reset-btn").addEventListener("click", async () => {
    const btn = document.getElementById("portal-reset-btn");
    if (client.portal_username) {
      const ok = await confirmDialog("¿Regenerar la contraseña del portal de este cliente? La contraseña anterior deja de funcionar de inmediato.");
      if (!ok) return;
    }
    btn.disabled = true;
    try {
      const r = await api.post(`/clients/${id}/portal/reset-password`, {});
      client.portal_username = r.portal_username;
      document.getElementById("portal-username-value").textContent = r.portal_username;
      showPortalPasswordReveal(document.getElementById("portal-password-reveal"), r.portal_username, r.portal_password_plain);
      btn.innerHTML = `${icon("refresh")} Regenerar contraseña`;
      toast("Acceso al portal listo", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  const ssnRevealBtn = document.getElementById("ssn-reveal-btn");
  if (ssnRevealBtn) {
    ssnRevealBtn.addEventListener("click", async () => {
      ssnRevealBtn.disabled = true;
      try {
        const { ssn_full } = await api.post(`/clients/${id}/ssn/reveal`, {});
        document.getElementById("ssn-full-value").textContent = ssn_full;
        ssnRevealBtn.textContent = "Ocultar";
        ssnRevealBtn.disabled = false;
        ssnRevealBtn.onclick = () => {
          document.getElementById("ssn-full-value").textContent = "•••-••-••••";
          renderClientDetail(container, id);
        };
      } catch (err) {
        toast(err.message, "error");
        ssnRevealBtn.disabled = false;
      }
    });
  }

  renderClientFreezeSection(document.getElementById("freeze-quickcopy"), document.getElementById("freeze-rows"), id, client);

  renderClientCreditScore(document.getElementById("client-credit-score"), id);
  renderClientDocuments(document.getElementById("client-documents"), id);
  const addressesBox = document.getElementById("client-addresses");
  renderClientAddresses(addressesBox, id);

  const itemsBox = document.getElementById("client-credit-items");
  const earningsBox = document.getElementById("client-earnings");
  renderClientCreditItems(itemsBox, id, earningsBox);

  document.getElementById("add-item-btn").addEventListener("click", () => {
    openCreditItemModal({ clientId: id, onSaved: () => renderClientCreditItems(itemsBox, id, earningsBox) });
  });

  const bulkGenBtn = document.getElementById("bulk-gen-btn");
  bulkGenBtn.addEventListener("click", async () => {
    bulkGenBtn.disabled = true;
    const orig = bulkGenBtn.innerHTML;
    bulkGenBtn.innerHTML = `${icon("spark")} Generando…`;
    try {
      await runSmartGenerateForClient(id, () => renderClientCreditItems(itemsBox, id, earningsBox));
    } finally {
      bulkGenBtn.disabled = false;
      bulkGenBtn.innerHTML = orig;
    }
  });

  const importInput = document.getElementById("import-report-input");
  const importBtn = document.getElementById("import-report-btn");
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    const originalLabel = importBtn.innerHTML;
    importBtn.disabled = true;
    importBtn.innerHTML = `${icon("spark")} Leyendo reporte…`;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.upload(`/clients/${id}/credit-report/import`, fd);
      if (r.inserted === 0 && r.skipped_duplicates === 0) {
        toast(r.message || "No se encontraron cuentas negativas en este reporte.", "error");
      } else {
        toast(`${r.inserted} ítem(s) nuevo(s) importado(s)${r.skipped_duplicates ? `, ${r.skipped_duplicates} ya existían` : ""}`, "success");
      }
      if (r.items_removed) {
        toast(`🎉 ${r.items_removed} ítem(s) ya no aparecen en el reporte — marcados como borrados`, "success");
      }
      if (r.addresses_removed) {
        toast(`${r.addresses_removed} dirección(es) ya no aparecen en el reporte — marcadas como "Ya no aparece"`, "success");
      }
      if (r.client_fields_filled && r.client_fields_filled.length) {
        toast(`Se completaron datos del cliente que estaban vacíos: ${r.client_fields_filled.join(", ")}`, "success");
      }
      // Recarga toda la ficha (no solo la tabla de ítems) para reflejar los datos del cliente que
      // se hayan podido rellenar automáticamente y el historial de direcciones actualizado.
      renderClientDetail(container, id);
      return;
    } catch (err) {
      toast(err.message, "error");
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = originalLabel;
      importInput.value = "";
    }
  });

  document.getElementById("client-activity").innerHTML = activity.length
    ? activity
        .map(
          (a) => `<div class="timeline-item"><div class="timeline-body"><div class="t-action">${ACTION_LABELS[a.action] || a.action}</div><div class="t-time">${formatDateTime(a.created_at)}</div></div></div>`
        )
        .join("")
    : `<div class="empty text-sm">Sin actividad todavía.</div>`;

  const lettersBox = document.getElementById("client-letters");
  await renderClientLetters(lettersBox, id, letters);

  document.getElementById("edit-client").addEventListener("click", () => {
    openClientModal(client, () => renderClientDetail(container, id));
  });
  document.getElementById("new-letter-btn").addEventListener("click", () => {
    window.__prefillClientId = client.id;
    window.__creditflowNavigate("#/cartas/nueva");
  });
}
