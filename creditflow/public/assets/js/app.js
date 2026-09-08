import { api } from "./api.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { initials } from "./utils.js";

import { renderLoginOrSetup } from "./sections/auth-screens.js";
import { renderDashboard } from "./sections/dashboard.js";
import { renderClientsList, renderClientDetail } from "./sections/clients.js";
import { renderTemplates } from "./sections/templates.js";
import { renderLettersList, renderLetterDetail, renderNewLetter } from "./sections/letters.js";
import { renderMailings } from "./sections/mailings.js";
import { renderSettings } from "./sections/settings.js";
import { renderEarningsDashboard } from "./sections/earnings.js";
import { bootPortal } from "./sections/portal.js";

const root = document.getElementById("root");

export const AppState = {
  user: null,
  uspsConfigured: false,
};

const NAV = [
  { key: "dashboard", hash: "#/dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "clientes", hash: "#/clientes", label: "Clientes", icon: "users" },
  { key: "ganancias", hash: "#/ganancias", label: "Ganancias", icon: "dollar" },
  { key: "plantillas", hash: "#/plantillas", label: "Plantillas", icon: "file" },
  { key: "cartas", hash: "#/cartas", label: "Cartas", icon: "mail" },
  { key: "envios", hash: "#/envios", label: "Envíos certificados", icon: "send" },
  { key: "ajustes", hash: "#/ajustes", label: "Ajustes", icon: "settings" },
];

async function boot() {
  let status;
  try {
    status = await api.get("/auth/status");
  } catch (e) {
    root.innerHTML = `<div class="auth-screen"><div class="auth-card"><div class="auth-error">No se pudo conectar con el servidor: ${e.message}</div></div></div>`;
    return;
  }

  if (status.needsSetup || !status.authenticated) {
    renderLoginOrSetup(root, status, boot);
    return;
  }

  AppState.user = status.user;
  AppState.uspsConfigured = status.uspsConfigured;
  renderShell();
  window.addEventListener("hashchange", route);
  if (!location.hash) location.hash = "#/dashboard";
  route();
}

function renderShell() {
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <span class="mark">⚡</span>
          <span class="name">CreditFlow</span>
        </div>
        <nav id="nav-groups"></nav>
        <div class="sidebar-foot">
          <div class="user-chip">
            <div class="user-avatar">${initials(AppState.user.full_name || AppState.user.username)}</div>
            <div class="user-meta">
              <div class="u-name">${AppState.user.full_name || AppState.user.username}</div>
              <div class="u-role">${AppState.user.role}</div>
            </div>
            <button class="logout-btn" id="logout-btn" title="Cerrar sesión">${icon("logout")}</button>
          </div>
        </div>
      </aside>
      <div class="main-area">
        <div class="topbar">
          <button class="hamburger" id="hamburger">${icon("chevronDown")}</button>
          <div>
            <h1 id="topbar-title">CreditFlow</h1>
            <div class="sub" id="topbar-sub"></div>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>
  `;

  const navGroups = document.getElementById("nav-groups");
  navGroups.innerHTML = `
    <div class="nav-group">
      <div class="nav-label">Menú</div>
      ${NAV.map((n) => `<a class="nav-link" data-key="${n.key}" href="${n.hash}">${icon(n.icon)}<span>${n.label}</span></a>`).join("")}
    </div>
  `;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    location.hash = "";
    boot();
  });

  document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  navGroups.querySelectorAll(".nav-link").forEach((a) =>
    a.addEventListener("click", () => document.getElementById("sidebar").classList.remove("open"))
  );
}

function setActiveNav(key) {
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.key === key));
}

function setTitle(title, sub) {
  document.getElementById("topbar-title").textContent = title;
  document.getElementById("topbar-sub").textContent = sub || "";
}

async function route() {
  const content = document.getElementById("content");
  const hash = location.hash || "#/dashboard";
  const parts = hash.replace("#/", "").split("/").filter(Boolean);
  const base = parts[0] || "dashboard";
  const id = parts[1];

  content.classList.remove("view-fade");
  void content.offsetWidth;
  content.classList.add("view-fade");

  try {
    switch (base) {
      case "dashboard":
        setActiveNav("dashboard");
        setTitle("Dashboard", "Resumen general de tu operación");
        await renderDashboard(content);
        break;
      case "clientes":
        setActiveNav("clientes");
        if (id) {
          setTitle("Cliente", "Perfil, cartas y actividad");
          await renderClientDetail(content, id);
        } else {
          setTitle("Clientes", "Administra a tus clientes de reparación de crédito");
          await renderClientsList(content);
        }
        break;
      case "ganancias":
        setActiveNav("ganancias");
        setTitle("Ganancias", "Cuánto ganarías si se borran los ítems pendientes, y cuánto ya es ganancia real");
        await renderEarningsDashboard(content);
        break;
      case "plantillas":
        setActiveNav("plantillas");
        setTitle("Plantillas de cartas", "La biblioteca de cartas que usarás para generar disputas");
        await renderTemplates(content);
        break;
      case "cartas":
        setActiveNav("cartas");
        if (id === "nueva") {
          setTitle("Nueva carta", "Elige un cliente y una plantilla para generar la carta");
          await renderNewLetter(content);
        } else if (id) {
          setTitle("Carta", "Editar, imprimir y dar seguimiento al proceso");
          await renderLetterDetail(content, id);
        } else {
          setTitle("Cartas", "Todas las cartas creadas y su estado");
          await renderLettersList(content);
        }
        break;
      case "envios":
        setActiveNav("envios");
        setTitle("Envíos certificados", "Envía por certifiedmaillabels.com y rastrea la entrega");
        await renderMailings(content);
        break;
      case "ajustes":
        setActiveNav("ajustes");
        setTitle("Ajustes", "Tu cuenta, tu equipo y la configuración de rastreo");
        await renderSettings(content);
        break;
      default:
        setActiveNav("dashboard");
        await renderDashboard(content);
    }
  } catch (e) {
    if (e.status === 401) {
      boot();
      return;
    }
    content.innerHTML = `<div class="card"><div class="auth-error">Ocurrió un error: ${e.message}</div></div>`;
    toast(e.message, "error");
  }
}

window.__creditflowNavigate = (hash) => {
  location.hash = hash;
};

// El portal del cliente ("#/portal") es una app completamente aparte de la tuya — su propia
// pantalla de acceso, su propia sesión (cookie distinta) y su propia vista, así que ni siquiera
// intenta la sesión de tu equipo (/auth/status) cuando la URL empieza así.
if (location.hash.startsWith("#/portal")) {
  bootPortal();
} else {
  boot();
}
