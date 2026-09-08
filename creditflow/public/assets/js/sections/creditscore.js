import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../modal.js";
import { formatDate, escapeHtml } from "../utils.js";

const BUREAUS = ["Equifax", "TransUnion", "Experian"];
const BUREAU_COLORS = { Equifax: "#f87171", TransUnion: "#22d3ee", Experian: "#a78bfa" };

/* ------------------------------------------------------------------ */
/* Sección "Credit Score" — historial y tendencia por buró (manual)    */
/* ------------------------------------------------------------------ */
export async function renderClientCreditScore(container, clientId) {
  async function load() {
    const { scores } = await api.get(`/clients/${clientId}/scores`);
    draw(scores);
  }

  function draw(scores) {
    const byBureau = {};
    BUREAUS.forEach((b) => (byBureau[b] = scores.filter((s) => s.bureau === b)));

    const summaryCards = BUREAUS.map((b) => {
      const sorted = [...byBureau[b]].sort((a, c) => a.recorded_on.localeCompare(c.recorded_on));
      const last = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      let trend = `<span class="text-sm text-muted">sin registros</span>`;
      if (last && prev) {
        const diff = last.score - prev.score;
        trend =
          diff === 0
            ? `<span class="text-sm text-muted">sin cambio</span>`
            : diff > 0
            ? `<span class="text-sm" style="color:var(--green);font-weight:700">▲ +${diff}</span>`
            : `<span class="text-sm" style="color:var(--red);font-weight:700">▼ ${diff}</span>`;
      } else if (last) {
        trend = `<span class="text-sm text-muted">primera lectura</span>`;
      }
      return `
        <div class="card" style="padding:14px">
          <div class="text-sm text-muted" style="margin-bottom:2px">${b}</div>
          <div style="font-size:26px;font-weight:800;color:${BUREAU_COLORS[b]}">${last ? last.score : "—"}</div>
          <div style="margin-top:4px">${trend}</div>
          ${last ? `<div class="text-sm text-muted" style="margin-top:2px">al ${formatDate(last.recorded_on)}</div>` : ""}
        </div>
      `;
    }).join("");

    container.innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">${summaryCards}</div>
      ${
        scores.length
          ? `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Buró</th><th class="cell-num">Score</th><th>Fuente</th><th></th></tr></thead>
              <tbody>
                ${[...scores]
                  .sort((a, b) => b.recorded_on.localeCompare(a.recorded_on))
                  .map(
                    (s) => `
                  <tr>
                    <td class="row-sub">${formatDate(s.recorded_on)}</td>
                    <td>${escapeHtml(s.bureau)}</td>
                    <td class="cell-num"><strong>${s.score}</strong></td>
                    <td class="row-sub">${escapeHtml(s.source) || "—"}</td>
                    <td class="cell-actions"><button class="btn btn-danger btn-sm btn-icon" data-del-score="${s.id}">${icon("trash")}</button></td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `
          : `<div class="empty"><div class="mark">📈</div><h3>Sin historial todavía</h3><p>Se llena solo cuando importas un reporte de crédito que traiga el score.</p></div>`
      }
    `;

    container.querySelectorAll("[data-del-score]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog("¿Eliminar este registro de score?");
        if (!ok) return;
        try {
          await api.del(`/clients/${clientId}/scores/${btn.dataset.delScore}`);
          toast("Registro eliminado", "success");
          await load();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  await load();
}
