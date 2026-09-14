import { api } from "./api.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";
import { initials } from "./utils.js";

import { renderLoginOrSetup } from "./sections/auth-screens.js";
import { renderDashboardV7 } from "./sections/dashboard-v7.js";
import { renderClientsList, renderClientDetail } from "./sections/clients-v7.js";
import { renderEarningsV7 } from "./sections/earnings-v7.js";
import {
  renderTemplatesV7,
  renderLettersListV7,
  renderLetterDetailV7,
  renderNewLetterV7,
  renderMailingsV7,
  renderPortalUsersV7,
  renderSettingsV7,
} from "./sections/wrappers-v7.js";
import { bootPortal } from "./sections/portal.js";

const root = document.getElementById("root");

export const AppState = { user:null, uspsConfigured:false };

const NAV_GROUPS = [
  { label:"Operación", items:[
    {key:"dashboard",hash:"#/dashboard",label:"Centro de control",icon:"dashboard"},
    {key:"clientes",hash:"#/clientes",label:"Expedientes",icon:"users"},
    {key:"ganancias",hash:"#/ganancias",label:"Resultados y cobros",icon:"dollar"},
  ]},
  { label:"Flujo de trabajo", items:[
    {key:"cartas",hash:"#/cartas",label:"Cartas",icon:"mail"},
    {key:"envios",hash:"#/envios",label:"Envíos certificados",icon:"send"},
    {key:"plantillas",hash:"#/plantillas",label:"Estrategia y plantillas",icon:"file"},
  ]},
  { label:"Administración", items:[
    {key:"usuarios",hash:"#/usuarios",label:"Portal de clientes",icon:"link"},
    {key:"ajustes",hash:"#/ajustes",label:"Sistema",icon:"settings"},
  ]},
];

async function boot(){
  let status;
  try{status=await api.get("/auth/status");}
  catch(e){root.innerHTML=`<div class="auth-screen"><div class="auth-card"><div class="auth-error">No se pudo conectar con el servidor: ${e.message}</div></div></div>`;return;}
  if(status.needsSetup||!status.authenticated){renderLoginOrSetup(root,status,boot);return;}
  AppState.user=status.user; AppState.uspsConfigured=status.uspsConfigured;
  renderShell();
  window.addEventListener("hashchange",route);
  if(!location.hash) location.hash="#/dashboard";
  route();
}

function renderShell(){
  root.innerHTML=`
    <div class="app-shell cf7-shell">
      <aside class="sidebar cf7-sidebar" id="sidebar">
        <div class="cf7-brand">
          <div class="cf7-brand-mark">CF</div>
          <div><strong>CreditFlow</strong><span>Credit Repair OS</span></div>
        </div>
        <nav class="cf7-nav" id="nav-groups"></nav>
        <div class="cf7-sidebar-foot">
          <div class="cf7-system-chip"><span></span> Sistema conectado</div>
          <div class="cf7-user">
            <div class="user-avatar">${initials(AppState.user.full_name||AppState.user.username)}</div>
            <div><strong>${AppState.user.full_name||AppState.user.username}</strong><span>${AppState.user.role}</span></div>
            <button id="logout-btn">${icon("logout")}</button>
          </div>
        </div>
      </aside>
      <div class="cf7-main">
        <header class="cf7-topbar">
          <button class="cf7-mobile-menu" id="hamburger">☰</button>
          <div><div class="cf7-breadcrumb" id="topbar-breadcrumb">CreditFlow</div><h1 id="topbar-title">CreditFlow</h1><p id="topbar-sub"></p></div>
          <div class="cf7-top-status"><span></span> Online</div>
        </header>
        <main class="cf7-content" id="content"></main>
      </div>
    </div>`;

  const nav=document.getElementById("nav-groups");
  nav.innerHTML=NAV_GROUPS.map(g=>`
    <div class="cf7-nav-group"><span>${g.label}</span>
      ${g.items.map(n=>`<a data-key="${n.key}" href="${n.hash}"><i>${icon(n.icon)}</i><b>${n.label}</b></a>`).join("")}
    </div>`).join("");

  document.getElementById("logout-btn").addEventListener("click",async()=>{try{await api.post("/auth/logout");}catch{} location.hash=""; boot();});
  document.getElementById("hamburger").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
  nav.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>document.getElementById("sidebar").classList.remove("open")));
}

function setActive(key){document.querySelectorAll(".cf7-nav a").forEach(a=>a.classList.toggle("active",a.dataset.key===key));}
function setTitle(title,sub,breadcrumb){document.getElementById("topbar-title").textContent=title;document.getElementById("topbar-sub").textContent=sub||"";document.getElementById("topbar-breadcrumb").textContent=breadcrumb||"CreditFlow";}

async function route(){
  const content=document.getElementById("content");
  const parts=(location.hash||"#/dashboard").replace("#/","").split("/").filter(Boolean);
  const base=parts[0]||"dashboard", id=parts[1];
  content.className=`cf7-content-inner view-${base}${id?" view-detail":""}`;

  try{
    if(base==="dashboard"){setActive("dashboard");setTitle("Centro de control","Prioridades, resultados y trabajo pendiente","Operación");await renderDashboardV7(content);}
    else if(base==="clientes"){
      setActive("clientes");
      if(id){setTitle("Expediente del cliente","Todo el caso organizado por áreas de trabajo","Operación / Expedientes");await renderClientDetail(content,id);}
      else{setTitle("Expedientes","Clientes y estado general de cada caso","Operación");await renderClientsList(content);}
    }
    else if(base==="ganancias"){setActive("ganancias");setTitle("Resultados y cobros","Remociones, pagos y potencial de la cartera","Operación");await renderEarningsV7(content);}
    else if(base==="cartas"){
      setActive("cartas");
      if(id==="nueva"){setTitle("Nueva carta","Composición manual","Flujo / Cartas");await renderNewLetterV7(content);}
      else if(id){setTitle("Carta","Documento, estado y seguimiento","Flujo / Cartas");await renderLetterDetailV7(content,id);}
      else{setTitle("Cartas","Borradores, listas, enviadas y resultados","Flujo");await renderLettersListV7(content);}
    }
    else if(base==="envios"){setActive("envios");setTitle("Envíos certificados","Preparación, tracking e historial","Flujo");await renderMailingsV7(content);}
    else if(base==="plantillas"){setActive("plantillas");setTitle("Estrategia y plantillas","Biblioteca y flujo de disputa","Flujo");await renderTemplatesV7(content);}
    else if(base==="usuarios"){setActive("usuarios");setTitle("Portal de clientes","Accesos privados de tus clientes","Administración");await renderPortalUsersV7(content);}
    else if(base==="ajustes"){setActive("ajustes");setTitle("Sistema","Seguridad, equipo e integraciones","Administración");await renderSettingsV7(content);}
    else{location.hash="#/dashboard";}
  }catch(e){
    if(e.status===401){boot();return;}
    content.innerHTML=`<div class="card"><div class="auth-error">Ocurrió un error: ${e.message}</div></div>`;
    toast(e.message,"error");
  }
}

window.__creditflowNavigate=(hash)=>{location.hash=hash;};
let wasPortal=location.hash.startsWith("#/portal");
window.addEventListener("hashchange",()=>{const now=location.hash.startsWith("#/portal");if(now!==wasPortal){location.reload();return;}wasPortal=now;});
if(location.hash.startsWith("#/portal")) bootPortal(); else boot();
