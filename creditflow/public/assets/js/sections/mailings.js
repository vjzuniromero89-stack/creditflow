import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../modal.js";
import { escapeHtml, formatDate, formatDateTime, statusBadge } from "../utils.js";
import { AppState } from "../app.js";
import { roundLabel } from "./letters.js";

const CERTIFIED_MAIL_URL = "https://www.certifiedmaillabels.com/create-address-label";

export async function renderMailings(container) {
  container.innerHTML = `
    <div class="section-head">
      <div class="sub">
        Envía tus cartas certificadas a través de <a href="https://www.certifiedmaillabels.com" target="_blank" rel="noopener">certifiedmaillabels.com</a>
        y da seguimiento a la entrega.
        ${AppState.uspsConfigured ? "" : `<br/><span class="text-muted">El rastreo automático de USPS no está configurado todavía — puedes activarlo desde Ajustes.</span>`}
      </div>
      <div class="flex gap-12">
        <a class="btn btn-ghost" href="${CERTIFIED_MAIL_URL}" target="_blank" rel="noopener">${icon("link")} certifiedmaillabels.com</a>
        ${AppState.uspsConfigured ? `<button class="btn btn-primary" id="refresh-all-btn">${icon("refresh")} Actualizar todos</button>` : ""}
      </div>
    </div>

    <div class="section-head" style="margin-top:6px">
      <h2 style="font-size:16px">Listas para enviar</h2>
      <button class="btn btn-danger btn-sm" id="delete-all-ready-btn">${icon("trash")} Borrar todo</button>
    </div>
    <div class="table-wrap" style="margin-bottom:26px"><div id="ready-table"></div></div>

    <div class="section-head">
      <h2 style="font-size:16px">Envíos en curso / historial</h2>
    </div>
    <div class="table-wrap"><div id="mailings-table"></div></div>
  `;

  document.getElementById("delete-all-ready-btn").addEventListener("click", async () => {
    const { letters } = await api.get("/letters?status=lista");
    if (!letters.length) {
      toast("No hay cartas en \"Listas para enviar\"", "error");
      return;
    }
    const ok = await confirmDialog(`¿Borrar las ${letters.length} carta(s) de "Listas para enviar"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    let failed = 0;
    for (const l of letters) {
      try {
        await api.del(`/letters/${l.id}`);
      } catch {
        failed++;
      }
    }
    toast(failed ? `${letters.length - failed} carta(s) eliminada(s), ${failed} fallaron` : `${letters.length} carta(s) eliminada(s)`, failed ? "error" : "success");
    await loadReady();
  });

  async function loadReady() {
    const { letters } = await api.get("/letters?status=lista");
    const box = document.getElementById("ready-table");
    if (!letters.length) {
      box.innerHTML = `<div class="empty text-sm">No hay cartas esperando ser enviadas.</div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Carta</th><th>Cliente</th><th>Ronda</th><th></th></tr></thead>
        <tbody>
          ${letters
            .map(
              (l) => `
            <tr data-id="${l.id}">
              <td class="row-name">${escapeHtml(l.title)}</td>
              <td>${escapeHtml(l.client_name)}</td>
              <td>${roundLabel(l.round_number)}</td>
              <td class="cell-actions"><button class="btn btn-primary btn-sm" data-open="${l.id}">${icon("send")} Enviar</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    box.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        window.__creditflowNavigate(`#/cartas/${b.dataset.open}`);
      })
    );
    box.querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", () => window.__creditflowNavigate(`#/cartas/${tr.dataset.id}`))
    );
  }

  async function loadMailings() {
    const { mailings } = await api.get("/mailings");
    const box = document.getElementById("mailings-table");
    if (!mailings.length) {
      box.innerHTML = `<div class="empty"><div class="mark">📬</div><h3>Sin envíos todavía</h3><p>Cuando envíes una carta certificada, aparecerá aquí.</p></div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Rastreo</th><th>Cliente</th><th>Carta</th><th>Estado</th><th>Enviado</th><th></th></tr></thead>
        <tbody>
          ${mailings
            .map(
              (m) => `
            <tr data-letter="${m.letter_id}">
              <td class="row-name">${escapeHtml(m.tracking_number) || "—"}</td>
              <td>${escapeHtml(m.client_name)}</td>
              <td class="row-sub">${escapeHtml(m.letter_title)}</td>
              <td>${statusBadge(m.letter_status)}</td>
              <td class="row-sub">${formatDate(m.mailed_at)}</td>
              <td class="cell-actions">
                ${AppState.uspsConfigured ? `<button class="btn btn-ghost btn-sm btn-icon" data-refresh="${m.id}" title="Actualizar rastreo">${icon("refresh")}</button>` : ""}
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
        window.__creditflowNavigate(`#/cartas/${tr.dataset.letter}`);
      })
    );
    box.querySelectorAll("[data-refresh]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await api.post(`/mailings/${b.dataset.refresh}/refresh`);
          toast("Rastreo actualizado", "success");
          loadMailings();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  const refreshAllBtn = document.getElementById("refresh-all-btn");
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", async () => {
      try {
        const r = await api.post("/mailings/refresh-all");
        toast(`${r.updated} envíos actualizados`, "success");
        loadMailings();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  await Promise.all([loadReady(), loadMailings()]);
}
