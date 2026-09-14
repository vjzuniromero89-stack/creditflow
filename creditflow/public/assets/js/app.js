import { api } from "./api.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { initials } from "./utils.js";

import { renderLoginOrSetup } from "./sections/auth-screens.js";
import { renderDashboard } from "./sections/dashboard.js";
import { renderClientsList, renderClientDetail } from "./sections/clients-auto.js";
import { renderPortalUsers } from "./sections/users.js";
import { renderTemplates } from "./sections/templates-pro.js";
import { renderLettersList, renderLetterDetail, renderNewLetter } from "./sections/letters.js";
import { renderMailings } from "./sections/mailings.js";
import { renderSettings } from "./sections/settings.js";
import { renderEarningsDashboard } from "./sections/earnings.js";
import { bootPortal } from "./sections/portal.js";

const root = document.getElementById("root");
export const AppState = { user: null, uspsConfigured: false };

const NAV_GROUPS = [
  { label:"Operación", items:[
    {key:"dashboard",hash:"#/dashboard",label:"Dashboard",icon:"dashboard"},
    {key:"clientes",hash:"#/clientes",label:"Clientes",icon:"users"},
    {key:"ganancias",hash:"#/ganancias",label:"Ganancias",icon:"dollar"},
  ]},
  { label:"Trabajo", items:[
    {key:"cartas",hash:"#/cartas",label:"Cartas",icon:"mail"},
    {key:"envios",hash:"#/envios",label:"Envíos certificados",icon:"send"},
    {key:"plantillas",hash:"#/plantillas",label:"Estrategia y plantillas",icon:"file"},
  ]},
  { label:"Administración", items:[
    {key:"usuarios",hash:"#/usuarios",label:"Usuarios portal",icon:"link"},
    {key:"ajustes",hash:"#/ajustes",label:"Ajustes",icon:"settings"},
  ]},
];

async function boot(){
  let status;
  try{ status=await api.get("/auth/status"); }
  catch(e){ root.innerHTML=`<div class="auth-screen"><div class="auth-card"><div class="auth-error">No se pudo conectar con el servidor: ${e.message}</div></div></div>`; return; }
  if(status.needsSetup||!status.authenticated){ renderLoginOrSetup(root,status,boot); return; }
  AppState.user=status.user; AppState.uspsConfigured=status.uspsConfigured;
  renderShell();
  window.addEventListener("hashchange",route);
  if(!location.hash) location.hash="#/dashboard";
  route();
}

function renderShell(){
  root.innerHTML=`
    <div class="app-shell cf-shell">
      <aside class="sidebar cf-sidebar" id="sidebar">
        <div class="cf-brand"><div class="cf-brand-mark">CF</div><div><div class="cf-brand-name">CreditFlow</div><div class="cf-brand-sub">Credit Repair OS</div></div></div>
        <div class="cf-nav-scroll"><nav id="nav-groups"></nav></div>
        <div class="sidebar-foot cf-sidebar-foot">
          <div class="cf-system-status"><span class="cf-status-dot"></span><span>Automatización activa</span></div>
          <div class="user-chip cf-user-chip">
            <div class="user-avatar">${initials(AppState.user.full_name||AppState.user.username)}</div>
            <div class="user-meta"><div class="u-name">${AppState.user.full_name||AppState.user.username}</div><div class="u-role">${AppState.user.role}</div></div>
            <button class="logout-btn" id="logout-btn" title="Cerrar sesión">${icon("logout")}</button>
          </div>
        </div>
      </aside>
      <div class="main-area cf-main">
        <header class="topbar cf-topbar">
          <div class="cf-topbar-left">
            <button class="hamburger cf-hamburger" id="hamburger">${icon("chevronDown")}</button>
            <div><div class="cf-breadcrumb" id="topbar-breadcrumb">CreditFlow</div><h1 id="topbar-title">CreditFlow</h1><div class="sub" id="topbar-sub"></div></div>
          </div>
          <div class="cf-topbar-right"><div class="cf-health-chip"><span class="cf-status-dot"></span>Sistema operativo</div></div>
        </header>
        <main class="content cf-content" id="content"></main>
      </div>
    </div>`;
  document.getElementById("nav-groups").innerHTML=NAV_GROUPS.map(g=>`
    <div class="nav-group cf-nav-group"><div class="nav-label cf-nav-label">${g.label}</div>
    ${g.items.map(n=>`<a class="nav-link cf-nav-link" data-key="${n.key}" href="${n.hash}"><span class="cf-nav-icon">${icon(n.icon)}</span><span>${n.label}</span></a>`).join("")}</div>`).join("");
  document.getElementById("logout-btn").addEventListener("click",async()=>{ try{await api.post("/auth/logout");}catch{} location.hash=""; boot(); });
  document.getElementById("hamburger").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
  document.querySelectorAll(".nav-link").forEach(a=>a.addEventListener("click",()=>document.getElementById("sidebar").classList.remove("open")));
}

function setActiveNav(key){ document.querySelectorAll(".nav-link").forEach(a=>a.classList.toggle("active",a.dataset.key===key)); }
function setTitle(title,sub,breadcrumb="CreditFlow"){ document.getElementById("topbar-title").textContent=title; document.getElementById("topbar-sub").textContent=sub||""; document.getElementById("topbar-breadcrumb").textContent=breadcrumb; }

async function route(){
  const content=document.getElementById("content");
  const parts=(location.hash||"#/dashboard").replace("#/","").split("/").filter(Boolean);
  const base=parts[0]||"dashboard", id=parts[1];
  content.className=`content cf-content view-${base}${id?" view-detail":""}`;
  content.classList.remove("view-fade"); void content.offsetWidth; content.classList.add("view-fade");
  try{
    switch(base){
      case "dashboard": setActiveNav("dashboard"); setTitle("Dashboard","Resumen general de tu operación","Operación"); await renderDashboard(content); break;
      case "clientes":
        setActiveNav("clientes");
        if(id){ setTitle("Expediente del cliente","Estrategia, documentos, disputas y seguimiento","Operación / Clientes"); await renderClientDetail(content,id); }
        else{ setTitle("Clientes","Gestiona todos los expedientes y su progreso","Operación"); await renderClientsList(content); }
        break;
      case "usuarios": setActiveNav("usuarios"); setTitle("Usuarios del portal","Accesos privados para tus clientes","Administración"); await renderPortalUsers(content); break;
      case "ganancias": setActiveNav("ganancias"); setTitle("Ganancias","Remociones confirmadas, por cobrar y potencial","Operación"); await renderEarningsDashboard(content); break;
      case "plantillas": setActiveNav("plantillas"); setTitle("Estrategia y plantillas","Playbook profesional y biblioteca de correspondencia","Trabajo"); await renderTemplates(content); break;
      case "cartas":
        setActiveNav("cartas");
        if(id==="nueva"){ setTitle("Nueva carta","Prepara una carta para un cliente","Trabajo / Cartas"); await renderNewLetter(content); }
        else if(id){ setTitle("Carta","Revisión, edición, impresión y seguimiento","Trabajo / Cartas"); await renderLetterDetail(content,id); }
        else{ setTitle("Cartas","Borradores, listas, enviadas y completadas","Trabajo"); await renderLettersList(content); }
        break;
      case "envios": setActiveNav("envios"); setTitle("Envíos certificados","Lotes, tracking y estado de entrega","Trabajo"); await renderMailings(content); break;
      case "ajustes": setActiveNav("ajustes"); setTitle("Ajustes","Cuenta, equipo, seguridad e integraciones","Administración"); await renderSettings(content); break;
      default: location.hash="#/dashboard";
    }
  }catch(e){
    if(e.status===401){ boot(); return; }
    content.innerHTML=`<div class="card cf-error-card"><div class="auth-error">Ocurrió un error: ${e.message}</div></div>`;
    toast(e.message,"error");
  }
}
window.__creditflowNavigate=(hash)=>{location.hash=hash;};
let __wasPortalHash=location.hash.startsWith("#/portal");
window.addEventListener("hashchange",()=>{const p=location.hash.startsWith("#/portal"); if(p!==__wasPortalHash){location.reload();return;} __wasPortalHash=p;});
if(location.hash.startsWith("#/portal")) bootPortal(); else boot();
