// Portal del cliente — completamente separado de la app de tu equipo: su propia pantalla de
// acceso, su propia sesión (cookie "portal_session", nunca "session") y su propia vista de solo
// lectura del caso. Nunca pide ni muestra tarifas/precios — esa información es solo tuya y vive
// en Ganancias, dentro de la app de tu equipo.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml, formatDate } from "../utils.js";
import { CATEGORY_META } from "./collections.js";

const root = document.getElementById("root");
const ADDRESS_STATUS_LABELS = { activa: "Activa", disputada: "Disputada", eliminada: "Ya no aparece" };

const PortalState = { client: null };

export async function bootPortal() {
  let status;
  try {
    status = await api.get("/portal/status");
  } catch (e) {
    root.innerHTML = `<div class="auth-screen"><div class="auth-card"><div class="auth-error">No se pudo conectar con el servidor: ${e.message}</div></div></div>`;
    return;
  }

  if (!status.authenticated) {
    renderPortalLogin();
    return;
  }

  PortalState.client = status.client;
  renderPortalShell();
  routePortal();
}

function renderPortalLogin() {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><span class="mark">⚡</span><span class="name">CreditFlow</span></div>
        <div class="auth-sub">Portal del cliente — entra con el usuario y contraseña que te dieron para ver cómo va tu proceso.</div>
        <div id="portal-login-error"></div>
        <form id="portal-login-form">
          <div class="field" style="margin-bottom:16px">
            <label>Usuario</label>
            <input type="text" name="username" required autofocus />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <input type="password" name="password" required />
          </div>
          <button class="btn btn-primary" type="submit">Entrar</button>
        </form>
        <div class="auth-foot">¿Eres el dueño del negocio? <a href="#/dashboard" id="portal-staff-link">Entra aquí</a>.</div>
      </div>
    </div>
  `;

  document.getElementById("portal-staff-link").addEventListener("click", (e) => {
    e.preventDefault();
    location.hash = "#/dashboard";
    location.reload();
  });

  document.getElementById("portal-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("portal-login-error");
    errBox.innerHTML = "";
    try {
      await api.post("/portal/login", { username: fd.get("username"), password: fd.get("password") });
      bootPortal();
    } catch (err) {
      errBox.innerHTML = `<div class="auth-error">${err.message}</div>`;
    }
  });
}

function renderPortalShell() {
  root.innerHTML = `
    <div class="main-area" style="min-height:100vh">
      <div class="topbar">
        <div>
          <h1>⚡ CreditFlow — Portal</h1>
          <div class="sub">Hola, ${escapeHtml(PortalState.client.full_name)} — así va tu proceso</div>
        </div>
        <div class="topbar-actions">
          <button class="btn btn-ghost btn-sm" id="portal-logout-btn">${icon("logout")} Cerrar sesión</button>
        </div>
      </div>
      <div class="content" id="portal-content"></div>
    </div>
  `;
  document.getElementById("portal-logout-btn").addEventListener("click", async () => {
    try {
      await api.post("/portal/logout");
    } catch {}
    bootPortal();
  });
}

async function routePortal() {
  const content = document.getElementById("portal-content");
  if (!content) return;
  try {
    await renderPortalCase(content);
  } catch (e) {
    if (e.status === 401) {
      bootPortal();
      return;
    }
    content.innerHTML = `<div class="card"><div class="auth-error">Ocurrió un error: ${e.message}</div></div>`;
  }
}

async function renderPortalCase(content) {
  content.innerHTML = `<div class="text-sm text-muted">Cargando...</div>`;
  const { items, addresses } = await api.get("/portal/case");

  const total = items.length;
  const removedCount = items.filter((it) => it.removed_status === "eliminado").length;
  const categoriesPresent = [...new Set(items.map((it) => it.category))];

  content.innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:24px">
      <div class="card kpi-card kpi-c1">
        <div class="kpi-label">Ítems detectados</div>
        <div class="kpi-value">${total}</div>
      </div>
      <div class="card kpi-card kpi-c3">
        <div class="kpi-label">Ya removidos</div>
        <div class="kpi-value">${removedCount}</div>
      </div>
      <div class="card kpi-card kpi-c2">
        <div class="kpi-label">Todavía en el reporte</div>
        <div class="kpi-value">${total - removedCount}</div>
      </div>
    </div>

    <div class="section-head">
      <h2 style="font-size:16px">Tu caso por categoría</h2>
    </div>
    ${
      total
        ? `
      <div class="tag-row" id="portal-cat-filters" style="margin-bottom:12px">
        <button class="pill-filter active" data-cat="">Todas (${total})</button>
        ${categoriesPresent
          .map((cat) => {
            const n = items.filter((it) => it.category === cat).length;
            return `<button class="pill-filter" data-cat="${cat}">${escapeHtml((CATEGORY_META[cat] || { label: cat }).label)} (${n})</button>`;
          })
          .join("")}
      </div>
      <div class="table-wrap" style="margin-bottom:28px"><div id="portal-items-table"></div></div>`
        : `<div class="empty" style="margin-bottom:28px"><div class="mark">🗂️</div><h3>Todavía no hay ítems cargados</h3><p>En cuanto tu especialista importe tu reporte de crédito, verás aquí el detalle de tu caso.</p></div>`
    }

    <div class="section-head">
      <h2 style="font-size:16px">Historial de direcciones</h2>
      <p class="text-sm text-muted" style="margin-top:2px">Direcciones que han aparecido en tus reportes de crédito.</p>
    </div>
    ${
      addresses.length
        ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Dirección</th><th>Estado</th><th>Burós</th><th>Última vez reportada</th></tr></thead>
          <tbody>
            ${addresses
              .map(
                (a) => `
              <tr>
                <td class="row-name">${escapeHtml(a.address_line)}</td>
                <td><span class="badge badge-${a.status}">${ADDRESS_STATUS_LABELS[a.status] || a.status}</span></td>
                <td class="row-sub">${escapeHtml(a.bureaus) || "—"}</td>
                <td class="row-sub">${a.last_reported ? formatDate(a.last_reported) : "—"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
        : `<div class="empty"><div class="mark">🏠</div><h3>Sin direcciones todavía</h3></div>`
    }
  `;

  if (!total) return;

  function drawItemsTable(filterCat) {
    const box = document.getElementById("portal-items-table");
    const filtered = filterCat ? items.filter((it) => it.category === filterCat) : items;
    if (!filtered.length) {
      box.innerHTML = `<div class="empty text-sm">Sin ítems en esta categoría.</div>`;
      return;
    }
    box.innerHTML = `
      <table class="table-compact">
        <thead><tr><th>Categoría</th><th>Acreedor</th><th>Cuenta</th><th class="cell-num">Saldo</th><th>Burós</th><th>Cartas enviadas</th><th>Estado</th></tr></thead>
        <tbody>
          ${filtered
            .map(
              (it) => `
            <tr>
              <td><span class="badge badge-${it.category}">${escapeHtml(it.category_label)}</span></td>
              <td class="row-name">${escapeHtml(it.creditor_name) || "—"}</td>
              <td class="row-sub">${escapeHtml(it.account_number) || "—"}</td>
              <td class="row-sub cell-num">${escapeHtml(it.balance) || "—"}</td>
              <td class="row-sub">${escapeHtml(it.bureaus) || "—"}</td>
              <td class="row-sub">${it.letters_count || 0}</td>
              <td>${
                it.removed_status === "eliminado"
                  ? `<span class="badge badge-eliminada">Removido del reporte</span>`
                  : `<span class="badge badge-activa">Todavía en el reporte</span>`
              }</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  drawItemsTable("");
  document.querySelectorAll("#portal-cat-filters .pill-filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#portal-cat-filters .pill-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      drawItemsTable(btn.dataset.cat);
    })
  );
}
