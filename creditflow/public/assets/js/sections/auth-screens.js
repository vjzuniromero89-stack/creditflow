import { api } from "../api.js";

export function renderLoginOrSetup(root, status, onDone) {
  if (status.needsSetup) {
    renderSetup(root, onDone);
  } else {
    renderLogin(root, onDone);
  }
}

function renderSetup(root, onDone) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><span class="mark">⚡</span><span class="name">CreditFlow</span></div>
        <div class="auth-sub">Bienvenido. Antes de empezar, crea tu cuenta de administrador. Esto solo aparece una vez.</div>
        <div id="setup-error"></div>
        <form id="setup-form">
          <div class="field" style="margin-bottom:16px">
            <label>Tu nombre</label>
            <input type="text" name="full_name" placeholder="Ej. Victor Zúñiga" required />
          </div>
          <div class="field" style="margin-bottom:16px">
            <label>Usuario</label>
            <input type="text" name="username" placeholder="Ej. victor" minlength="3" required />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <input type="password" name="password" placeholder="Mínimo 8 caracteres" minlength="8" required />
          </div>
          <button class="btn btn-primary" type="submit">Crear cuenta y entrar</button>
        </form>
        <div class="auth-foot">Tus datos se guardan de forma segura en tu propia base de datos de Cloudflare.</div>
      </div>
    </div>
  `;

  document.getElementById("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("setup-error");
    errBox.innerHTML = "";
    try {
      await api.post("/setup/init", {
        full_name: fd.get("full_name"),
        username: fd.get("username"),
        password: fd.get("password"),
      });
      onDone();
    } catch (err) {
      errBox.innerHTML = `<div class="auth-error">${err.message}</div>`;
    }
  });
}

function renderLogin(root, onDone) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand"><span class="mark">⚡</span><span class="name">CreditFlow</span></div>
        <div class="auth-sub">Inicia sesión para gestionar clientes y cartas de reparación de crédito.</div>
        <div id="login-error"></div>
        <form id="login-form">
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
      </div>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("login-error");
    errBox.innerHTML = "";
    try {
      await api.post("/auth/login", { username: fd.get("username"), password: fd.get("password") });
      onDone();
    } catch (err) {
      errBox.innerHTML = `<div class="auth-error">${err.message}</div>`;
    }
  });
}
