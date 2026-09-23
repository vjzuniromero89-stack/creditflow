import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDate, initials } from "../utils.js";
import { AppState } from "../app.js";

export async function renderSettings(container) {
  container.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h3 style="font-size:15px;margin-bottom:16px">Cambiar contraseña</h3>
        <form id="pwd-form">
          <div class="field" style="margin-bottom:12px"><label>Contraseña actual</label><input type="password" name="current_password" required /></div>
          <div class="field" style="margin-bottom:16px"><label>Nueva contraseña</label><input type="password" name="new_password" minlength="8" required /></div>
          <button class="btn btn-primary" type="submit">Actualizar contraseña</button>
        </form>
      </div>

      <div class="card">
        <h3 style="font-size:15px;margin-bottom:10px">Rastreo automático (USPS)</h3>
        <p class="text-sm text-muted" style="margin-bottom:14px">
          ${
            AppState.uspsConfigured
              ? "✅ Configurado. Los envíos certificados se pueden actualizar automáticamente."
              : "⚠️ No configurado. Puedes seguir usando la app y actualizar el estado de los envíos manualmente. Para activar el rastreo automático, crea credenciales gratis en developer.usps.com y agrégalas como variables de entorno <code>USPS_CLIENT_ID</code> y <code>USPS_CLIENT_SECRET</code> en este Worker de Cloudflare (ver INSTRUCCIONES.md)."
          }
        </p>
        <a class="btn btn-ghost btn-block" href="https://developer.usps.com" target="_blank" rel="noopener">${icon("link")} developer.usps.com</a>
      </div>
    </div>

    <div class="section-head" style="margin-top:26px">
      <h2 style="font-size:16px">Equipo</h2>
      ${AppState.user.role === "admin" ? `<button class="btn btn-primary btn-sm" id="new-user-btn">${icon("plus")} Agregar usuario</button>` : ""}
    </div>
    <div class="table-wrap"><div id="users-table"></div></div>

    ${
      AppState.user.role === "admin"
        ? `
    <div class="card" id="new-user-card" style="display:none;margin-top:16px">
      <h3 style="font-size:15px;margin-bottom:14px">Nuevo usuario</h3>
      <form id="new-user-form" class="form-grid">
        <div class="field"><label>Nombre</label><input type="text" name="full_name" required /></div>
        <div class="field"><label>Usuario</label><input type="text" name="username" minlength="3" required /></div>
        <div class="field"><label>Contraseña</label><input type="password" name="password" minlength="8" required /></div>
        <div class="field">
          <label>Rol</label>
          <select name="role"><option value="agente">Agente</option><option value="admin">Administrador</option></select>
        </div>
        <div class="form-actions" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Crear usuario</button></div>
      </form>
    </div>`
        : ""
    }
  `;

  document.getElementById("pwd-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.post("/auth/change-password", {
        current_password: fd.get("current_password"),
        new_password: fd.get("new_password"),
      });
      toast("Contraseña actualizada", "success");
      e.target.reset();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  async function loadUsers() {
    const { users } = await api.get("/auth/users");
    document.getElementById("users-table").innerHTML = `
      <table>
        <thead><tr><th>Usuario</th><th>Rol</th><th>Desde</th></tr></thead>
        <tbody>
          ${users
            .map(
              (u) => `
            <tr>
              <td><div class="flex gap-12" style="align-items:center"><div class="user-avatar" style="width:28px;height:28px;font-size:10px">${initials(u.full_name || u.username)}</div>${escapeHtml(u.full_name || u.username)} <span class="row-sub">(${escapeHtml(u.username)})</span></div></td>
              <td><span class="badge badge-activo">${u.role}</span></td>
              <td class="row-sub">${formatDate(u.created_at)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  const newUserBtn = document.getElementById("new-user-btn");
  if (newUserBtn) {
    newUserBtn.addEventListener("click", () => {
      const card = document.getElementById("new-user-card");
      card.style.display = card.style.display === "none" ? "block" : "none";
    });
    document.getElementById("new-user-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api.post("/auth/users", Object.fromEntries(fd.entries()));
        toast("Usuario creado", "success");
        e.target.reset();
        document.getElementById("new-user-card").style.display = "none";
        loadUsers();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  await loadUsers();
}
