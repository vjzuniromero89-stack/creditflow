import { api } from "../api.js";
import { icon } from "../icons.js";
import { openModal, confirmDialog } from "../modal.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";

const STATUS_LABELS = { activa: "Activa", disputada: "Disputada", eliminada: "Ya no aparece" };

function addressFormHtml(a = {}) {
  return `
    <form id="address-form">
      <div class="form-grid">
        <div class="field" style="grid-column:1/-1"><label>Dirección *</label><input type="text" name="address_line" required value="${escapeHtml(a.address_line)}" placeholder="Ej. 123 Main St, Bradenton, FL 34203" /></div>
        <div class="field">
          <label>Estado</label>
          <select name="status">
            ${Object.entries(STATUS_LABELS).map(([k, label]) => `<option value="${k}" ${a.status === k || (!a.status && k === "activa") ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Burós que la reportan</label><input type="text" name="bureaus" placeholder="Ej. Equifax, TransUnion" value="${escapeHtml(a.bureaus)}" /></div>
        <div class="field"><label>Primera vez reportada</label><input type="text" name="first_reported" placeholder="MM/AA" value="${escapeHtml(a.first_reported)}" /></div>
        <div class="field"><label>Última vez reportada</label><input type="text" name="last_reported" placeholder="MM/AA" value="${escapeHtml(a.last_reported)}" /></div>
        <div class="field" style="grid-column:1/-1"><label>Notas</label><textarea name="notes" style="min-height:60px">${escapeHtml(a.notes)}</textarea></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${a.id ? "Guardar cambios" : "Agregar dirección"}</button>
      </div>
    </form>
  `;
}

function openAddressModal(existing, clientId, onSaved) {
  const { close, body } = openModal({
    title: existing ? "Editar dirección" : "Agregar dirección manualmente",
    bodyHtml: addressFormHtml(existing || {}),
    wide: true,
  });
  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#address-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      if (existing) {
        await api.put(`/clients/${clientId}/addresses/${existing.id}`, payload);
        toast("Dirección actualizada", "success");
      } else {
        await api.post(`/clients/${clientId}/addresses`, payload);
        toast("Dirección agregada", "success");
      }
      close();
      onSaved();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Sección "Direcciones del cliente" — historial completo             */
/* ------------------------------------------------------------------ */
export async function renderClientAddresses(container, clientId) {
  async function load() {
    const { addresses } = await api.get(`/clients/${clientId}/addresses`);
    draw(addresses);
  }

  function draw(addresses) {
    container.innerHTML = `
      <div class="flex-between" style="margin-bottom:10px">
        <p class="text-sm text-muted" style="margin:0">Se llenan solas al importar un reporte de crédito. Cuando una dirección deja de aparecer en un reporte nuevo, se marca sola como "Ya no aparece".</p>
        <button class="btn btn-ghost btn-sm" id="add-address-btn">${icon("plus")} Agregar</button>
      </div>
      ${
        addresses.length
          ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Dirección</th><th>Estado</th><th>Burós</th><th>Reportada</th><th>Origen</th><th></th></tr></thead>
            <tbody>
              ${addresses
                .map(
                  (a) => `
                <tr data-id="${a.id}" style="${a.status === "eliminada" ? "opacity:.65" : ""}">
                  <td class="row-name">${escapeHtml(a.address_line)}</td>
                  <td><span class="badge badge-${a.status}">${STATUS_LABELS[a.status] || a.status}</span></td>
                  <td class="row-sub">${escapeHtml(a.bureaus) || "—"}</td>
                  <td class="row-sub">${escapeHtml(a.first_reported) || "—"}${a.last_reported && a.last_reported !== a.first_reported ? ` – ${escapeHtml(a.last_reported)}` : ""}</td>
                  <td class="row-sub">${a.source === "reporte_credito" ? "Reporte de crédito" : "Manual"}</td>
                  <td class="cell-actions">
                    ${a.status !== "disputada" && a.status !== "eliminada" ? `<button class="btn btn-ghost btn-sm" data-mark-disputed="${a.id}">Marcar disputada</button>` : ""}
                    <button class="btn btn-ghost btn-sm btn-icon" data-edit="${a.id}">${icon("edit")}</button>
                    <button class="btn btn-danger btn-sm btn-icon" data-del="${a.id}">${icon("trash")}</button>
                  </td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
          : `<div class="empty"><div class="mark">📍</div><h3>Sin direcciones todavía</h3><p>Importa un reporte de crédito o agrega una dirección a mano.</p></div>`
      }
    `;

    document.getElementById("add-address-btn").addEventListener("click", () => openAddressModal(null, clientId, load));

    container.querySelectorAll("[data-mark-disputed]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api.put(`/clients/${clientId}/addresses/${btn.dataset.markDisputed}`, { status: "disputada" });
          toast("Marcada como disputada", "success");
          await load();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );

    container.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const address = addresses.find((a) => String(a.id) === btn.dataset.edit);
        openAddressModal(address, clientId, load);
      })
    );

    container.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog("¿Eliminar esta dirección del historial? Esta acción no se puede deshacer.");
        if (!ok) return;
        try {
          await api.del(`/clients/${clientId}/addresses/${btn.dataset.del}`);
          toast("Dirección eliminada", "success");
          await load();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  await load();
}
