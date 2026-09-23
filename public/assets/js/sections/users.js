// Sección "Usuarios" — panel central de los accesos al Portal del Cliente (usuario/contraseña con
// los que cada cliente entra a ver su caso). Antes esto solo se veía/manejaba entrando a la ficha
// de cada cliente uno por uno; esta pantalla los lista a todos juntos para generar o regenerar
// accesos sin tener que ir cliente por cliente. No crea usuarios de tu equipo (agentes/admins) —
// esos se manejan en Ajustes.
import { api } from "../api.js";
import { icon } from "../icons.js";
import { openModal } from "../modal.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDate, debounce } from "../utils.js";
import { showPortalPasswordReveal } from "./clients.js";

export async function renderPortalUsers(container) {
  container.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Usuarios</h2>
        <p class="text-sm text-muted" style="margin-top:2px">Acceso de cada cliente a su Portal (usuario y contraseña con los que entra a ver su caso, su tarifa y lo que le toca pagar).</p>
      </div>
      <div class="flex gap-12">
        <div class="search-box">${icon("search")}<input type="search" id="portal-users-search" placeholder="Buscar cliente..." /></div>
        <button class="btn btn-ghost" id="portal-users-backfill-btn" title="Genera usuario y contraseña de portal para todos los clientes que todavía no lo tienen">${icon("refresh")} Generar accesos faltantes</button>
      </div>
    </div>
    <div class="table-wrap"><div id="portal-users-table"></div></div>
  `;

  async function load(q) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const { clients } = await api.get(`/clients?${params.toString()}`);
    renderTable(clients);
  }

  function renderTable(clients) {
    const box = document.getElementById("portal-users-table");
    if (!clients.length) {
      box.innerHTML = `<div class="empty"><div class="mark">🔑</div><h3>Sin clientes todavía</h3></div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Cliente</th><th>Usuario del portal</th><th>Acceso</th><th>Contraseña</th><th></th></tr></thead>
        <tbody>
          ${clients
            .map((c) => {
              const passwordStatus = !c.portal_username
                ? `<span class="text-muted">—</span>`
                : c.portal_must_change_password
                ? `<span class="badge badge-pausado" title="Todavía está usando la contraseña temporal test1234">Pendiente de cambiar</span>`
                : `<span class="badge badge-activo">Ya la cambió</span>`;
              return `
            <tr data-id="${c.id}">
              <td class="row-name">${escapeHtml(c.full_name)}</td>
              <td>${c.portal_username ? `<code>${escapeHtml(c.portal_username)}</code>` : `<span class="text-muted">— sin usuario —</span>`}</td>
              <td>${c.portal_username ? `<span class="badge badge-activo">Con acceso</span>` : `<span class="badge badge-pausado">Sin acceso</span>`}</td>
              <td>${passwordStatus}</td>
              <td class="cell-actions">
                ${c.has_portal_password ? `<button class="btn btn-ghost btn-sm" data-view="${c.id}">${icon("eye")} Ver contraseña</button>` : ""}
                <button class="btn btn-ghost btn-sm" data-reset="${c.id}">${icon("refresh")} ${c.portal_username ? "Regenerar contraseña" : "Generar acceso"}</button>
                <button class="btn btn-ghost btn-sm" data-open="${c.id}">Ver cliente</button>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;

    box.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", () => window.__creditflowNavigate(`#/clientes/${b.dataset.open}`))
    );
    box.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const r = await api.post(`/clients/${b.dataset.view}/portal/password-reveal`, {});
          const { body, close } = openModal({ title: "Contraseña actual del portal", bodyHtml: "" });
          body.innerHTML = `
            <div class="text-sm text-muted" style="margin-bottom:10px">${
              r.must_change_password
                ? "El cliente todavía no ha entrado a cambiarla — sigue siendo la temporal."
                : "El cliente ya creó esta contraseña él mismo."
            }</div>
          `;
          showPortalPasswordReveal(body, r.portal_username, r.portal_password_plain);
          body.insertAdjacentHTML("beforeend", `<div class="form-actions"><button type="button" class="btn btn-primary" id="portal-view-close">Listo</button></div>`);
          body.querySelector("#portal-view-close").addEventListener("click", close);
        } catch (err) {
          toast(err.message, "error");
        } finally {
          b.disabled = false;
        }
      })
    );
    box.querySelectorAll("[data-reset]").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = b.dataset.reset;
        b.disabled = true;
        const orig = b.innerHTML;
        b.innerHTML = "Generando…";
        try {
          const r = await api.post(`/clients/${id}/portal/reset-password`, {});
          const { body, close } = openModal({ title: "Acceso al portal", bodyHtml: "" });
          showPortalPasswordReveal(body, r.portal_username, r.portal_password_plain);
          body.insertAdjacentHTML("beforeend", `<div class="form-actions"><button type="button" class="btn btn-primary" id="portal-reveal-close">Listo</button></div>`);
          body.querySelector("#portal-reveal-close").addEventListener("click", close);
          toast("Acceso al portal listo", "success");
          load(document.getElementById("portal-users-search").value.trim());
        } catch (err) {
          toast(err.message, "error");
        } finally {
          b.disabled = false;
          b.innerHTML = orig;
        }
      })
    );
  }

  document.getElementById("portal-users-backfill-btn").addEventListener("click", async () => {
    const btn = document.getElementById("portal-users-backfill-btn");
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
          <p class="text-sm text-muted" style="margin-bottom:12px">Compártele a cada cliente su usuario y contraseña. Si necesitas volver a verla después, hazlo desde el botón "Ver contraseña" de la tabla.</p>
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
      load(document.getElementById("portal-users-search").value.trim());
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  document.getElementById("portal-users-search").addEventListener(
    "input",
    debounce((e) => load(e.target.value.trim()), 300)
  );

  load("");
}
