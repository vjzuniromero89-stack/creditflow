import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../modal.js";
import { formatDate, escapeHtml } from "../utils.js";

const BUREAUS = ["Equifax", "TransUnion", "Experian"];
const BUREAU_COLORS = { Equifax: "#f87171", TransUnion: "#22d3ee", Experian: "#a78bfa" };

// Por seguridad, la app no guarda ni usa las contraseñas de tus clientes para iniciar sesión
// automáticamente en estas plataformas (eso expondría datos financieros muy sensibles y viola
// los términos de uso de estos sitios) — en vez de eso, este selector te lleva directo a la
// plataforma para que consultes el score ahí (con tu sesión o la del cliente) y lo anotes aquí.
const SCORE_PLATFORMS = {
  "Credit Karma": "https://www.creditkarma.com/auth/logon",
  myFICO: "https://www.myfico.com/login",
  "Experian (consumidor)": "https://www.experian.com/member/login.html",
  "Equifax (consumidor)": "https://my.equifax.com/membercenter/",
  "TransUnion (consumidor)": "https://service.transunion.com/",
  IdentityIQ: "https://www.identityiq.com/login.aspx",
  SmartCredit: "https://www.smartcredit.com/login",
  "Informe del cliente / otro": "",
};

function buildScoreChartSvg(scoresByBureau) {
  const allPoints = Object.values(scoresByBureau).flat();
  if (!allPoints.length) return "";

  const minScore = Math.min(300, ...allPoints.map((p) => p.score)) - 10;
  const maxScore = Math.max(850, ...allPoints.map((p) => p.score)) + 10;
  const dates = [...new Set(allPoints.map((p) => p.recorded_on))].sort();
  const W = 640,
    H = 190,
    PAD = 26;
  const xFor = (date) => PAD + (dates.length > 1 ? dates.indexOf(date) / (dates.length - 1) : 0.5) * (W - PAD * 2);
  const yFor = (score) => H - PAD - ((score - minScore) / (maxScore - minScore)) * (H - PAD * 2);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="score-chart" preserveAspectRatio="none" role="img" aria-label="Historial de credit score">`;
  [300, 500, 700, 850].forEach((s) => {
    if (s < minScore || s > maxScore) return;
    const y = yFor(s).toFixed(1);
    svg += `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="rgba(255,255,255,.08)" /><text x="2" y="${Number(y) + 3}" font-size="9" fill="rgba(255,255,255,.4)">${s}</text>`;
  });
  Object.entries(scoresByBureau).forEach(([bureau, points]) => {
    if (!points.length) return;
    const sorted = [...points].sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
    const path = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.recorded_on).toFixed(1)},${yFor(p.score).toFixed(1)}`).join(" ");
    const color = BUREAU_COLORS[bureau] || "#94a3b8";
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    sorted.forEach((p) => {
      svg += `<circle cx="${xFor(p.recorded_on).toFixed(1)}" cy="${yFor(p.score).toFixed(1)}" r="3.5" fill="${color}"><title>${escapeHtml(bureau)}: ${p.score} (${p.recorded_on})</title></circle>`;
    });
  });
  svg += `</svg>`;
  return svg;
}

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

    const chart = buildScoreChartSvg(byBureau);

    container.innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">${summaryCards}</div>
      ${
        chart
          ? `<div class="card" style="margin-bottom:16px;overflow-x:auto">${chart}</div>`
          : `<div class="empty" style="margin-bottom:16px"><div class="mark">📈</div><h3>Sin historial todavía</h3><p>Agrega la primera lectura del score de este cliente abajo.</p></div>`
      }
      <div class="card">
        <h4 style="font-size:14px;margin-bottom:10px">Agregar lectura</h4>
        <form id="score-form" class="form-grid">
          <div class="field"><label>Buró</label><select name="bureau" required>${BUREAUS.map((b) => `<option value="${b}">${b}</option>`).join("")}</select></div>
          <div class="field"><label>Score</label><input type="number" name="score" min="250" max="900" required /></div>
          <div class="field"><label>Fecha</label><input type="date" name="recorded_on" required value="${new Date().toISOString().slice(0, 10)}" /></div>
          <div class="field">
            <label>Plataforma (opcional)</label>
            <div class="flex gap-8">
              <select name="source" id="score-source" style="flex:1">
                <option value="">— Selecciona —</option>
                ${Object.keys(SCORE_PLATFORMS).map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
              </select>
              <a class="btn btn-ghost btn-sm" id="score-source-link" href="#" target="_blank" rel="noopener" style="display:none;white-space:nowrap">${icon("link")} Abrir</a>
            </div>
          </div>
          <div class="form-actions" style="grid-column:1/-1"><button class="btn btn-primary btn-sm" type="submit">${icon("plus")} Agregar</button></div>
        </form>
        <p class="text-sm text-muted" style="margin-top:8px">Por seguridad, la app no inicia sesión sola en estos sitios (eso requeriría guardar la contraseña del cliente) — elige la plataforma, dale a "Abrir" para consultar el score ahí, y anótalo aquí manualmente.</p>
        ${
          scores.length
            ? `
          <div class="table-wrap" style="margin-top:14px">
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
        `
            : ""
        }
      </div>
    `;

    const sourceSelect = container.querySelector("#score-source");
    const sourceLink = container.querySelector("#score-source-link");
    sourceSelect.addEventListener("change", () => {
      const url = SCORE_PLATFORMS[sourceSelect.value];
      if (url) {
        sourceLink.href = url;
        sourceLink.style.display = "";
      } else {
        sourceLink.style.display = "none";
      }
    });

    container.querySelector("#score-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.post(`/clients/${clientId}/scores`, Object.fromEntries(fd.entries()));
        toast("Score agregado", "success");
        await load();
      } catch (err) {
        toast(err.message, "error");
      }
    });

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
